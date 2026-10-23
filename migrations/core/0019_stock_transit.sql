-- Add a non-available transit balance while preserving the exact ledger rows.
CREATE TABLE larder_movements_next (
 id TEXT PRIMARY KEY, sequence INTEGER NOT NULL UNIQUE, item_id TEXT NOT NULL, location_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('available','quarantine','transit')), lot_id TEXT NOT NULL DEFAULT '',
 quantity INTEGER NOT NULL CHECK(quantity<>0), unit_cost INTEGER NOT NULL CHECK(unit_cost>=0),
 kind TEXT NOT NULL, document_kind TEXT NOT NULL, document_id TEXT NOT NULL, reverses_id TEXT,
 actor_id TEXT NOT NULL, command_id TEXT NOT NULL, import_id TEXT, reason TEXT NOT NULL, created_at TEXT NOT NULL);
INSERT INTO larder_movements_next SELECT * FROM larder_movements;
DROP TRIGGER larder_reservation_insert;
DROP TRIGGER larder_reservation_grow;
DROP TABLE larder_movements;
ALTER TABLE larder_movements_next RENAME TO larder_movements;
CREATE INDEX larder_position ON larder_movements(item_id,location_id,status,lot_id);
CREATE INDEX larder_document ON larder_movements(document_kind,document_id);
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
