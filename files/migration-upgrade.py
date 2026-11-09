"""One-off preservation probe for the new journal vocabulary migration."""
import json
from pathlib import Path
import sqlite3

connection = sqlite3.connect(':memory:')
connection.executescript(Path('migrations/core/0026_change_events.sql').read_text())
retained = json.dumps({'id': 'synthetic-larder-upgrade:receipt.recorded:0', 'type': 'receipt.recorded', 'commandId': 'synthetic-larder-upgrade'}, separators=(',', ':'))
connection.execute('INSERT INTO larder_change_events(id,command_id,type,data) VALUES(?,?,?,?)', ('synthetic-larder-upgrade:receipt.recorded:0', 'synthetic-larder-upgrade', 'receipt.recorded', retained))
connection.execute("UPDATE sqlite_sequence SET seq=73 WHERE name='larder_change_events'")
connection.executescript(Path('migrations/core/0027_change_event_vocabulary.sql').read_text())
assert connection.execute('SELECT seq,id,data FROM larder_change_events').fetchall() == [(1, 'synthetic-larder-upgrade:receipt.recorded:0', retained)]
connection.execute('INSERT INTO larder_change_events(id,command_id,type,data) VALUES(?,?,?,?)', ('synthetic-larder-new:supplier.date-recorded:0', 'synthetic-larder-new', 'supplier.date-recorded', '{}'))
assert connection.execute('SELECT MAX(seq) FROM larder_change_events').fetchone()[0] == 74
for statement in ['DELETE FROM larder_change_events', "UPDATE larder_change_events SET type='quality.held'"]:
    try:
        connection.execute(statement)
        raise AssertionError('Append-only fence was lost')
    except sqlite3.IntegrityError as error:
        assert 'append_only_change_events' in str(error)
print(json.dumps({'probe':'vocabulary migration preserves event bytes, IDs, sequence high-water mark and append-only fences','exit':0,'retainedSequence':1,'priorHighWater':73,'newSequence':74}))
