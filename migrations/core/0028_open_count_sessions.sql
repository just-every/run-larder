-- Blind-count assignments are checked on every command and download. Index the
-- open sessions by counter so that check reads one row, however many finished
-- counts the record store retains.
CREATE INDEX larder_open_count_sessions ON larder_records(json_extract(data,'$.counterId'))
 WHERE kind='countSessions' AND json_extract(data,'$.status')<>'complete';
