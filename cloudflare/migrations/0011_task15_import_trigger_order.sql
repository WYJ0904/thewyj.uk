DROP TRIGGER IF EXISTS trg_task15_import_receipt_parent;
DROP TRIGGER IF EXISTS trg_task15_import_receipt_source_count;
DROP TRIGGER IF EXISTS trg_task15_import_receipt_complete;
DROP TRIGGER IF EXISTS trg_task15_import_receipt_overflow;
DROP TRIGGER IF EXISTS trg_task15_import_receipt_early_complete;

CREATE TRIGGER trg_task15_import_receipt_parent
BEFORE INSERT ON task15_import_receipts
WHEN NOT EXISTS (
    SELECT 1 FROM task15_import_batches
    WHERE source_key = NEW.source_key AND kind = NEW.kind
)
BEGIN
    SELECT RAISE(ABORT, 'task15_import_parent_missing');
END;

CREATE TRIGGER trg_task15_import_receipt_source_count
BEFORE INSERT ON task15_import_receipts
WHEN EXISTS (
    SELECT 1 FROM task15_import_batches
    WHERE source_key = NEW.source_key AND kind = NEW.kind AND complete = 0
)
AND NEW.source_count != (
    SELECT source_count FROM task15_import_batches
    WHERE source_key = NEW.source_key AND kind = NEW.kind
)
BEGIN
    SELECT RAISE(ABORT, 'task15_import_source_count_conflict');
END;

CREATE TRIGGER trg_task15_import_receipt_complete
BEFORE INSERT ON task15_import_receipts
WHEN (
    SELECT complete FROM task15_import_batches
    WHERE source_key = NEW.source_key AND kind = NEW.kind
) = 1
BEGIN
    SELECT RAISE(ABORT, 'task15_import_already_complete');
END;

CREATE TRIGGER trg_task15_import_receipt_overflow
BEFORE INSERT ON task15_import_receipts
WHEN EXISTS (
    SELECT 1 FROM task15_import_batches
    WHERE source_key = NEW.source_key
      AND kind = NEW.kind
      AND complete = 0
      AND source_count = NEW.source_count
)
AND NEW.received_count + COALESCE((
    SELECT SUM(received_count) FROM task15_import_receipts
    WHERE source_key = NEW.source_key AND kind = NEW.kind
), 0) > NEW.source_count
BEGIN
    SELECT RAISE(ABORT, 'task15_import_incomplete_source');
END;

CREATE TRIGGER trg_task15_import_receipt_early_complete
BEFORE INSERT ON task15_import_receipts
WHEN EXISTS (
    SELECT 1 FROM task15_import_batches
    WHERE source_key = NEW.source_key
      AND kind = NEW.kind
      AND complete = 0
      AND source_count = NEW.source_count
)
AND NEW.complete = 1
AND NEW.received_count + COALESCE((
    SELECT SUM(received_count) FROM task15_import_receipts
    WHERE source_key = NEW.source_key AND kind = NEW.kind
), 0) != NEW.source_count
BEGIN
    SELECT RAISE(ABORT, 'task15_import_incomplete_source');
END;
