-- Expand the native vocabulary without rewriting retained event bytes or IDs.
-- Keep the sequence high-water mark, including gaps, for stable saved cursors.
ALTER TABLE larder_change_events RENAME TO larder_change_events_previous;
CREATE TABLE larder_change_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 command_id TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('receipt.recorded','work.output-recorded','quality.held','quality.released','shipment.dispatched','supplier.date-recorded','material.usable')),
 data TEXT NOT NULL CHECK(json_valid(data))
);
INSERT INTO larder_change_events SELECT * FROM larder_change_events_previous ORDER BY seq;
UPDATE sqlite_sequence SET seq=MAX(seq,(SELECT seq FROM sqlite_sequence WHERE name='larder_change_events_previous')) WHERE name='larder_change_events';
DROP TABLE larder_change_events_previous;
CREATE INDEX larder_change_events_command ON larder_change_events(command_id,seq);
CREATE INDEX larder_change_events_type ON larder_change_events(type,seq);
CREATE TRIGGER larder_change_events_immutable BEFORE UPDATE ON larder_change_events BEGIN SELECT RAISE(ABORT,'append_only_change_events'); END;
CREATE TRIGGER larder_change_events_no_delete BEFORE DELETE ON larder_change_events BEGIN SELECT RAISE(ABORT,'append_only_change_events'); END;
