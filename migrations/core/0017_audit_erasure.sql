-- GOV-013: the audit is kept for the life of the installation and nothing purges it. The one
-- exception is an erasure request: through the erasure door a data subject's personal values in
-- entries are replaced by a tombstone. The door records the request here first; an entry may then
-- change only its personal columns, and only while it names a recorded request.
ALTER TABLE larder_audit ADD COLUMN erasure_id TEXT;
CREATE TABLE larder_audit_erasures (
 id TEXT PRIMARY KEY NOT NULL, at TEXT NOT NULL, actor_id TEXT NOT NULL,
 subject_kind TEXT NOT NULL CHECK(subject_kind IN ('operator','party')), subject_id TEXT NOT NULL,
 entries INTEGER NOT NULL);
CREATE TRIGGER larder_audit_erasures_immutable BEFORE UPDATE ON larder_audit_erasures BEGIN SELECT RAISE(ABORT,'append_only_audit'); END;
CREATE TRIGGER larder_audit_erasures_no_delete BEFORE DELETE ON larder_audit_erasures BEGIN SELECT RAISE(ABORT,'append_only_audit'); END;
DROP TRIGGER larder_audit_immutable;
CREATE TRIGGER larder_audit_immutable BEFORE UPDATE ON larder_audit
WHEN NOT (NEW.erasure_id IS NOT NULL AND EXISTS(SELECT 1 FROM larder_audit_erasures e WHERE e.id=NEW.erasure_id)
  AND NEW.seq=OLD.seq AND NEW.id=OLD.id AND NEW.at=OLD.at AND NEW.actor_id=OLD.actor_id AND NEW.actor_role=OLD.actor_role AND NEW.source=OLD.source
  AND NEW.command_id=OLD.command_id AND NEW.command_type=OLD.command_type AND NEW.domain=OLD.domain
  AND NEW.subject_kind=OLD.subject_kind AND NEW.subject_id=OLD.subject_id AND NEW.subject_version=OLD.subject_version AND NEW.op=OLD.op AND NEW.refs=OLD.refs)
BEGIN SELECT RAISE(ABORT,'append_only_audit'); END;
