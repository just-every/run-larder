-- GOV-004: the append-only audit. One row per record a command changed, written
-- in the same atomic batch as the change itself. Nothing updates or deletes a row.
CREATE TABLE larder_audit (
 seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE, at TEXT NOT NULL,
 actor_id TEXT NOT NULL, actor_name TEXT NOT NULL, actor_role TEXT NOT NULL, source TEXT NOT NULL CHECK(source IN ('person','agent','import')),
 command_id TEXT NOT NULL, command_type TEXT NOT NULL, domain TEXT NOT NULL,
 subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, subject_version INTEGER NOT NULL,
 op TEXT NOT NULL CHECK(op IN ('create','update','delete','post','bulk')),
 before TEXT NOT NULL CHECK(json_valid(before)), after TEXT NOT NULL CHECK(json_valid(after)),
 reason TEXT NOT NULL, evidence TEXT NOT NULL CHECK(json_valid(evidence)), refs TEXT NOT NULL);
CREATE INDEX larder_audit_domain ON larder_audit(domain,seq);
CREATE INDEX larder_audit_subject ON larder_audit(subject_kind,subject_id);
CREATE INDEX larder_audit_command ON larder_audit(command_id);
CREATE TRIGGER larder_audit_immutable BEFORE UPDATE ON larder_audit BEGIN SELECT RAISE(ABORT,'append_only_audit'); END;
CREATE TRIGGER larder_audit_no_delete BEFORE DELETE ON larder_audit BEGIN SELECT RAISE(ABORT,'append_only_audit'); END;
