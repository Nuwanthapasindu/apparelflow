-- ApparelFlow Cutting Gatekeeper: database-level rules.
-- Apply as a RAW SQL MIGRATION after the Prisma "init" migration:
--   yarn prisma migrate dev --create-only --name gatekeeper_constraints
--   (paste this file into the generated migration.sql, then: yarn prisma migrate dev)
--
-- Conventions: ids are TEXT (Prisma String @id); enums are compared via ::text;
-- custom SQLSTATEs: GK403 = wrong role, GK409 = illegal state, GK422 = hard stop.
-- The API pre-checks everything and returns clean 403/409/422. These rules are the backstop.

-- =====================================================================
-- 1. Value constraints
-- =====================================================================
ALTER TABLE cutting_orders
  ADD CONSTRAINT chk_orders_target_qty_pos CHECK (target_qty > 0),
  ADD CONSTRAINT chk_orders_fabric_pos     CHECK (actual_fabric_yds > 0),
  ADD CONSTRAINT chk_orders_attempt_pos    CHECK (current_attempt >= 1);

ALTER TABLE verification_items
  ADD CONSTRAINT chk_items_expected_pos  CHECK (expected_qty > 0),
  ADD CONSTRAINT chk_items_actual_nonneg CHECK (actual_qty IS NULL OR actual_qty >= 0),
  -- status must agree with the counts, and be NULL while uncounted
  ADD CONSTRAINT chk_items_status_matches CHECK (
    (actual_qty IS NULL AND status IS NULL) OR
    (actual_qty IS NOT NULL AND (
      (actual_qty = expected_qty AND status = 'GREEN')  OR
      (actual_qty > expected_qty AND status = 'YELLOW') OR
      (actual_qty < expected_qty AND status = 'RED')
    ))
  );

ALTER TABLE verification_logs
  -- mandatory rejection note, enforced in the DB as well as in Zod
  ADD CONSTRAINT chk_logs_reject_note CHECK (
    decision <> 'REJECTED' OR (rejection_note IS NOT NULL AND length(btrim(rejection_note)) > 0)
  ),
  -- an approval must carry the full fabric snapshot
  ADD CONSTRAINT chk_logs_approve_snapshot CHECK (
    decision <> 'APPROVED' OR (
      expected_fabric_yds IS NOT NULL AND actual_fabric_yds IS NOT NULL AND
      wastage_pct IS NOT NULL AND wastage_cap_pct IS NOT NULL AND over_cap IS NOT NULL
    )
  );

-- =====================================================================
-- 2. Immutability
-- =====================================================================
-- verification_logs: strictly append-only.
CREATE OR REPLACE FUNCTION forbid_log_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'verification_logs is append-only (% blocked)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_logs_immutable
  BEFORE UPDATE OR DELETE ON verification_logs
  FOR EACH ROW EXECUTE FUNCTION forbid_log_mutation();

-- verification_items: once a decision exists for that attempt, rows are frozen.
CREATE OR REPLACE FUNCTION forbid_decided_item_mutation() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM verification_logs l
    WHERE l.order_id = OLD.order_id AND l.attempt_no = OLD.attempt_no
  ) THEN
    RAISE EXCEPTION 'verification_items for a decided attempt are immutable (% blocked)', TG_OP;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_items_frozen_after_decision
  BEFORE UPDATE OR DELETE ON verification_items
  FOR EACH ROW EXECUTE FUNCTION forbid_decided_item_mutation();

-- =====================================================================
-- 3. Order INSERT guard: starts pending, attempt 1, created by an active supervisor
-- =====================================================================
CREATE OR REPLACE FUNCTION gk_order_insert_guard() RETURNS trigger AS $$
DECLARE
  v_role text;
  v_active boolean;
BEGIN
  IF NEW.status::text <> 'PENDING_VERIFICATION' OR NEW.current_attempt <> 1 THEN
    RAISE EXCEPTION 'new orders must start as PENDING_VERIFICATION, attempt 1' USING ERRCODE = 'GK409';
  END IF;
  SELECT role::text, is_active INTO v_role, v_active FROM users WHERE id = NEW.created_by;
  IF v_role IS DISTINCT FROM 'cutting_supervisor' OR NOT COALESCE(v_active, false) THEN
    RAISE EXCEPTION 'created_by must be an active cutting_supervisor' USING ERRCODE = 'GK403';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_insert_guard
  BEFORE INSERT ON cutting_orders
  FOR EACH ROW EXECUTE FUNCTION gk_order_insert_guard();

-- =====================================================================
-- 4. Verification log INSERT guard: THE HARD STOP IN THE DATABASE
-- =====================================================================
CREATE OR REPLACE FUNCTION gk_log_insert_guard() RETURNS trigger AS $$
DECLARE
  v_attempt int;
  v_status text;
  v_recipe text;
  v_role text;
  v_active boolean;
  v_components int;
  v_rows int;
  v_counted int;
  v_red int;
BEGIN
  SELECT current_attempt, status::text, recipe_id
    INTO v_attempt, v_status, v_recipe
    FROM cutting_orders WHERE id = NEW.order_id;

  IF v_status IS DISTINCT FROM 'PENDING_VERIFICATION' THEN
    RAISE EXCEPTION 'order is not pending verification' USING ERRCODE = 'GK409';
  END IF;
  IF NEW.attempt_no <> v_attempt THEN
    RAISE EXCEPTION 'attempt_no does not match the order current attempt' USING ERRCODE = 'GK409';
  END IF;

  SELECT role::text, is_active INTO v_role, v_active FROM users WHERE id = NEW.verifier_id;
  IF v_role IS DISTINCT FROM 'cutting_verifier' OR NOT COALESCE(v_active, false) THEN
    RAISE EXCEPTION 'verifier_id must be an active cutting_verifier' USING ERRCODE = 'GK403';
  END IF;

  IF NEW.decision::text = 'APPROVED' THEN
    SELECT count(*) INTO v_components FROM recipe_components WHERE recipe_id = v_recipe;
    SELECT count(*),
           count(*) FILTER (WHERE actual_qty IS NOT NULL),
           count(*) FILTER (WHERE status::text = 'RED')
      INTO v_rows, v_counted, v_red
      FROM verification_items
      WHERE order_id = NEW.order_id AND attempt_no = NEW.attempt_no;

    IF v_rows <> v_components OR v_counted <> v_components OR v_red > 0 THEN
      RAISE EXCEPTION 'cannot approve: components missing, uncounted, or RED' USING ERRCODE = 'GK422';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_log_insert_guard
  BEFORE INSERT ON verification_logs
  FOR EACH ROW EXECUTE FUNCTION gk_log_insert_guard();

-- =====================================================================
-- 5. Order UPDATE guard: state machine, VERIFIED needs an APPROVED log, attempt rules
-- =====================================================================
CREATE OR REPLACE FUNCTION gk_order_update_guard() RETURNS trigger AS $$
DECLARE
  v_role text;
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NOT (
      (OLD.status::text = 'PENDING_VERIFICATION' AND NEW.status::text IN ('VERIFIED', 'REJECTED')) OR
      (OLD.status::text = 'REJECTED'             AND NEW.status::text = 'PENDING_VERIFICATION') OR
      (OLD.status::text = 'VERIFIED'             AND NEW.status::text = 'IN_SEWING')
    ) THEN
      RAISE EXCEPTION 'illegal status transition % -> %', OLD.status, NEW.status USING ERRCODE = 'GK409';
    END IF;

    IF NEW.status::text = 'VERIFIED' AND NOT EXISTS (
      SELECT 1 FROM verification_logs
      WHERE order_id = NEW.id AND attempt_no = NEW.current_attempt AND decision::text = 'APPROVED'
    ) THEN
      RAISE EXCEPTION 'VERIFIED requires an APPROVED log for the current attempt' USING ERRCODE = 'GK422';
    END IF;

    IF NEW.status::text = 'REJECTED' AND NOT EXISTS (
      SELECT 1 FROM verification_logs
      WHERE order_id = NEW.id AND attempt_no = NEW.current_attempt AND decision::text = 'REJECTED'
    ) THEN
      RAISE EXCEPTION 'REJECTED requires a REJECTED log for the current attempt' USING ERRCODE = 'GK409';
    END IF;

    IF OLD.status::text = 'REJECTED' AND NEW.status::text = 'PENDING_VERIFICATION'
       AND NEW.current_attempt <> OLD.current_attempt + 1 THEN
      RAISE EXCEPTION 'resubmit must increment current_attempt by exactly 1' USING ERRCODE = 'GK409';
    END IF;

    IF NEW.status::text = 'IN_SEWING' THEN
      IF NEW.sewing_started_at IS NULL THEN
        RAISE EXCEPTION 'IN_SEWING requires sewing_started_at' USING ERRCODE = 'GK409';
      END IF;
      SELECT role::text INTO v_role FROM users WHERE id = NEW.sewing_started_by;
      IF v_role IS DISTINCT FROM 'sewing_supervisor' THEN
        RAISE EXCEPTION 'sewing_started_by must be a sewing_supervisor' USING ERRCODE = 'GK403';
      END IF;
    END IF;
  ELSE
    IF NEW.current_attempt <> OLD.current_attempt THEN
      RAISE EXCEPTION 'current_attempt can only change on resubmit' USING ERRCODE = 'GK409';
    END IF;
    IF NEW.sewing_started_by IS DISTINCT FROM OLD.sewing_started_by
       OR NEW.sewing_started_at IS DISTINCT FROM OLD.sewing_started_at THEN
      RAISE EXCEPTION 'sewing fields can only be set when starting sewing' USING ERRCODE = 'GK409';
    END IF;
  END IF;

  -- Once verified, the batch definition is frozen.
  IF OLD.status::text IN ('VERIFIED', 'IN_SEWING') AND (
       NEW.recipe_id <> OLD.recipe_id OR
       NEW.target_qty <> OLD.target_qty OR
       NEW.actual_fabric_yds <> OLD.actual_fabric_yds OR
       NEW.fabric_roll_id <> OLD.fabric_roll_id OR
       NEW.order_no <> OLD.order_no OR
       NEW.created_by <> OLD.created_by
     ) THEN
    RAISE EXCEPTION 'verified orders are frozen' USING ERRCODE = 'GK409';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_order_update_guard
  BEFORE UPDATE ON cutting_orders
  FOR EACH ROW EXECUTE FUNCTION gk_order_update_guard();

-- =====================================================================
-- 6. Verification item guard: only the current attempt of a pending order can change.
--    (Nested IFs on purpose: OLD does not exist on INSERT, and SQL does not
--     guarantee short-circuit evaluation inside a single boolean expression.)
-- =====================================================================
CREATE OR REPLACE FUNCTION gk_item_guard() RETURNS trigger AS $$
DECLARE
  v_attempt int;
  v_status text;
BEGIN
  SELECT current_attempt, status::text INTO v_attempt, v_status
    FROM cutting_orders WHERE id = NEW.order_id;

  IF v_status IS DISTINCT FROM 'PENDING_VERIFICATION' OR NEW.attempt_no <> v_attempt THEN
    RAISE EXCEPTION 'items can only change on the current attempt of a pending order' USING ERRCODE = 'GK409';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.order_id <> OLD.order_id
       OR NEW.component_id <> OLD.component_id
       OR NEW.attempt_no <> OLD.attempt_no
       OR NEW.component_name <> OLD.component_name
       OR NEW.expected_qty <> OLD.expected_qty THEN
      RAISE EXCEPTION 'item identity and expected_qty are immutable' USING ERRCODE = 'GK409';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_item_guard
  BEFORE INSERT OR UPDATE ON verification_items
  FOR EACH ROW EXECUTE FUNCTION gk_item_guard();

-- =====================================================================
-- 7. Read-only variance view (variance = actual - expected; negative = shortage)
-- =====================================================================
CREATE OR REPLACE VIEW verification_variances WITH (security_invoker = true) AS
SELECT order_id, attempt_no, component_id, component_name,
       expected_qty, actual_qty, (actual_qty - expected_qty) AS variance, status
FROM verification_items;

-- =====================================================================
-- 8. Row level security: Supabase exposes tables through its REST Data API with a
--    public key. Enable RLS with NO policies so that path is closed; the Prisma
--    role has BYPASSRLS and is unaffected. Also disable the Data API in the dashboard.
-- =====================================================================
ALTER TABLE users              ENABLE ROW LEVEL SECURITY;
ALTER TABLE refresh_tokens     ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes            ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipe_components  ENABLE ROW LEVEL SECURITY;
ALTER TABLE cutting_orders     ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE verification_logs  ENABLE ROW LEVEL SECURITY;
