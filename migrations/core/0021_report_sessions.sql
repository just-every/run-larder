-- Private native-session references are deliberately outside business archives.
-- They are not credentials and cannot establish a session.
CREATE TABLE larder_report_sessions (
  schedule_id TEXT PRIMARY KEY,
  actor TEXT NOT NULL
);
