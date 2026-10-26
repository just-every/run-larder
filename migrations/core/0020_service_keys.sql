-- Session-bound read credentials are deliberately excluded from business archives.
CREATE TABLE larder_service_keys (
  id TEXT PRIMARY KEY,
  digest TEXT NOT NULL UNIQUE,
  operator_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  operator_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1))
);
