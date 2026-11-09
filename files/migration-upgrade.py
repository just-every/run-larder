import hashlib, json, sqlite3
from pathlib import Path
root = Path('/workspace/run-larder')
db = sqlite3.connect(':memory:')
old = root/'migrations/core/0026_change_events.sql'
new = root/'migrations/core/0027_change_event_vocabulary.sql'
db.executescript(old.read_text())
for seq in [3,17]:
    data = json.dumps({'id':f'synthetic-larder-{seq}', 'type':'receipt.recorded','exact':'retained bytes'}, separators=(',',':'))
    db.execute('INSERT INTO larder_change_events VALUES(?,?,?,?,?)',(seq,f'synthetic-larder-{seq}',f'synthetic-larder-command-{seq}','receipt.recorded',data))
db.execute("UPDATE sqlite_sequence SET seq=31 WHERE name='larder_change_events'")
before = db.execute('SELECT * FROM larder_change_events ORDER BY seq').fetchall()
db.executescript(new.read_text())
assert db.execute('SELECT * FROM larder_change_events ORDER BY seq').fetchall() == before
for event_type in ['supplier.date-recorded','material.usable']:
    db.execute('INSERT INTO larder_change_events(id,command_id,type,data) VALUES(?,?,?,?)',(event_type,'synthetic-larder-upgrade',event_type,'{}'))
assert db.execute('SELECT seq FROM larder_change_events WHERE id=?',('supplier.date-recorded',)).fetchone()[0] == 32
assert db.execute('SELECT seq FROM larder_change_events WHERE id=?',('material.usable',)).fetchone()[0] == 33
for sql in ['UPDATE larder_change_events SET data=\'{}\' WHERE seq=3','DELETE FROM larder_change_events WHERE seq=17']:
    try: db.execute(sql)
    except sqlite3.IntegrityError as error: assert 'append_only_change_events' in str(error)
    else: raise AssertionError('append-only fence missing')
try: db.execute("INSERT INTO larder_change_events(id,command_id,type,data) VALUES('synthetic-larder-unknown','synthetic-larder-upgrade','ledger.reconciled','{}')")
except sqlite3.IntegrityError: pass
else: raise AssertionError('undelivered vocabulary accepted')
print(json.dumps({'probe':'journal schema upgrade','exit':0,'retainedRows':len(before),'oldHighWater':31,'nextSequences':[32,33],'appendOnly':'enforced','unknownVocabulary':'refused','migrationSha256':hashlib.sha256(new.read_bytes()).hexdigest()},sort_keys=True))
