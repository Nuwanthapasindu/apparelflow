-- Server-generated order numbers (CUT-00001 style). A sequence is race-free under concurrent
-- creates; gaps are fine. Additive only: no existing table or column changes.
CREATE SEQUENCE IF NOT EXISTS cutting_order_no_seq;
