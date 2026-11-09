-- Native manufacturing transitions, committed with their source records.
-- Only identifiers, revisions, quantities and evidence digests enter this journal.
CREATE TABLE larder_change_events (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 command_id TEXT NOT NULL,
 type TEXT NOT NULL CHECK(type IN ('receipt.recorded','work.output-recorded','quality.held','quality.released','shipment.dispatched')),
 data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE INDEX larder_change_events_command ON larder_change_events(command_id,seq);
CREATE INDEX larder_change_events_type ON larder_change_events(type,seq);
CREATE TRIGGER larder_change_events_immutable BEFORE UPDATE ON larder_change_events BEGIN SELECT RAISE(ABORT,'append_only_change_events'); END;
CREATE TRIGGER larder_change_events_no_delete BEFORE DELETE ON larder_change_events BEGIN SELECT RAISE(ABORT,'append_only_change_events'); END;
