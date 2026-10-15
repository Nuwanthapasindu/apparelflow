-- The accepted fabric range can produce wastage percentages far beyond NUMERIC(6,2).
-- Widening is lossless and leaves the immutable approval snapshots otherwise unchanged.
ALTER TABLE verification_logs
  ALTER COLUMN wastage_pct TYPE NUMERIC(14,2);
