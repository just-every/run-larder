-- Larder's operational ledger. Quantities and money are fixed-point integers
-- with six decimal places (1 unit = 1000000). Movements are append-only; the
-- triggers below refuse any write that would make a stock position negative
-- or leave available stock below its reservations, whatever code issued it.
CREATE TABLE larder_meta (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL);
INSERT INTO larder_meta VALUES(1,0);
CREATE TABLE larder_guard (id TEXT PRIMARY KEY, ok INTEGER NOT NULL CHECK(ok=1));
CREATE TABLE larder_records (kind TEXT NOT NULL, id TEXT NOT NULL, version INTEGER NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), PRIMARY KEY(kind,id));
CREATE TABLE larder_movements (
 id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE, item_id TEXT NOT NULL, location_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('available','quarantine')), lot_id TEXT NOT NULL DEFAULT '',
 quantity INTEGER NOT NULL CHECK(quantity<>0), unit_cost INTEGER NOT NULL CHECK(unit_cost>=0),
 kind TEXT NOT NULL, document_kind TEXT NOT NULL, document_id TEXT NOT NULL, reverses_id TEXT,
 actor_id TEXT NOT NULL, command_id TEXT NOT NULL, import_id TEXT, reason TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX larder_position ON larder_movements(item_id,location_id,status,lot_id);
CREATE INDEX larder_document ON larder_movements(document_kind,document_id);
CREATE TABLE larder_reservations (
 id TEXT PRIMARY KEY, demand_kind TEXT NOT NULL CHECK(demand_kind IN ('sales','work')), demand_id TEXT NOT NULL,
 line_id TEXT NOT NULL, item_id TEXT NOT NULL, location_id TEXT NOT NULL, quantity INTEGER NOT NULL CHECK(quantity>0));
CREATE INDEX larder_reserved ON larder_reservations(item_id,location_id);
CREATE TRIGGER larder_movement_immutable BEFORE UPDATE ON larder_movements BEGIN SELECT RAISE(ABORT,'append_only_movement'); END;
CREATE TRIGGER larder_movement_no_delete BEFORE DELETE ON larder_movements
 WHEN NOT EXISTS(SELECT 1 FROM larder_guard WHERE id='import-undo:'||OLD.import_id AND ok=1)
 BEGIN SELECT RAISE(ABORT,'append_only_movement'); END;
CREATE TRIGGER larder_movement_nonnegative BEFORE INSERT ON larder_movements
 WHEN NEW.quantity<0 AND (SELECT COALESCE(SUM(quantity),0) FROM larder_movements WHERE item_id=NEW.item_id AND location_id=NEW.location_id AND status=NEW.status AND lot_id=NEW.lot_id)+NEW.quantity<0
 BEGIN SELECT RAISE(ABORT,'negative_stock'); END;
CREATE TRIGGER larder_movement_reserved BEFORE INSERT ON larder_movements
 WHEN NEW.quantity<0 AND NEW.status='available' AND (SELECT COALESCE(SUM(quantity),0) FROM larder_movements WHERE item_id=NEW.item_id AND location_id=NEW.location_id AND status='available')+NEW.quantity<(SELECT COALESCE(SUM(quantity),0) FROM larder_reservations WHERE item_id=NEW.item_id AND location_id=NEW.location_id)
 BEGIN SELECT RAISE(ABORT,'reserved_stock'); END;
CREATE TRIGGER larder_reservation_insert BEFORE INSERT ON larder_reservations
 WHEN (SELECT COALESCE(SUM(quantity),0) FROM larder_movements WHERE item_id=NEW.item_id AND location_id=NEW.location_id AND status='available')-(SELECT COALESCE(SUM(quantity),0) FROM larder_reservations WHERE item_id=NEW.item_id AND location_id=NEW.location_id)<NEW.quantity
 BEGIN SELECT RAISE(ABORT,'oversold'); END;
CREATE TRIGGER larder_reservation_grow BEFORE UPDATE OF quantity ON larder_reservations
 WHEN NEW.quantity>OLD.quantity AND (SELECT COALESCE(SUM(quantity),0) FROM larder_movements WHERE item_id=NEW.item_id AND location_id=NEW.location_id AND status='available')-(SELECT COALESCE(SUM(quantity),0) FROM larder_reservations WHERE item_id=NEW.item_id AND location_id=NEW.location_id)<NEW.quantity-OLD.quantity
 BEGIN SELECT RAISE(ABORT,'oversold'); END;
CREATE TABLE larder_commands (id TEXT PRIMARY KEY, actor_id TEXT NOT NULL, type TEXT NOT NULL, digest TEXT NOT NULL, result TEXT NOT NULL CHECK(json_valid(result)), created_at TEXT NOT NULL);
CREATE INDEX larder_command_time ON larder_commands(created_at);
CREATE TABLE larder_attachments (id TEXT PRIMARY KEY, name TEXT NOT NULL, content_type TEXT NOT NULL, size INTEGER NOT NULL CHECK(size>0 AND size<=1048576), sha256 TEXT NOT NULL, bytes BLOB NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE larder_import_graphs (id TEXT PRIMARY KEY, revision TEXT NOT NULL, descriptor TEXT NOT NULL CHECK(json_valid(descriptor)));
