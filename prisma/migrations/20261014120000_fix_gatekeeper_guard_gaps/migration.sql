-- Fix four gaps in the Day 1 guards found by probing with direct SQL.
--
-- 1. The approval guard counted item ROWS, so an item for a component of another recipe could
--    stand in for a missing component. Items must now belong to the order's recipe, must carry
--    the recipe's name and expected quantity (target_qty x pieces_per_garment), and the
--    approval guard counts only items that match the order's recipe components.
-- 2. btrim() only strips spaces, so a rejection note made of tabs, newlines or no-break spaces
--    counted as non-blank. A note now needs at least one visible character: Unicode whitespace,
--    NEL and zero-width / invisible characters do not count. (Written as \u escapes on purpose,
--    so an editor cannot normalise the characters away. Keep the Zod rule in sync.)
-- 5. Race: a count could be committed RED while an approval, which had read the old GREEN rows,
--    committed too. The item guard now takes FOR SHARE and the approval guard FOR UPDATE on the
--    order row (order first, like the API), so the two serialise.
-- 3. A deactivated sewing supervisor could still start sewing (the guard checked the role only).
-- 4. target_qty and recipe_id could change while an order was PENDING or REJECTED, leaving the
--    items' expected_qty snapshots stale. The batch definition is now immutable in every status;
--    only actual_fabric_yds may change, and only while the order is REJECTED (re-cut).

-- ---------------------------------------------------------------------
-- 2. Rejection note must contain a non-whitespace character
-- ---------------------------------------------------------------------
ALTER TABLE verification_logs DROP CONSTRAINT chk_logs_reject_note;
ALTER TABLE verification_logs
  ADD CONSTRAINT chk_logs_reject_note CHECK (
    decision <> 'REJECTED' OR (
      rejection_note IS NOT NULL
      AND rejection_note ~ '[^[:space:]\u0085\u00a0\u00ad\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u2064\u3000\u3164\ufeff]'
    )
  );

-- ---------------------------------------------------------------------
-- 1. Item guard: items must match the order's recipe, name and expected quantity
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gk_item_guard() RETURNS trigger AS $$
DECLARE
  v_attempt int;
  v_status text;
  v_recipe text;
  v_target int;
  v_name text;
  v_pieces int;
BEGIN
  SELECT current_attempt, status::text, recipe_id, target_qty
    INTO v_attempt, v_status, v_recipe, v_target
    FROM cutting_orders WHERE id = NEW.order_id
    FOR SHARE;

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

  IF TG_OP = 'INSERT' THEN
    SELECT component_name, pieces_per_garment INTO v_name, v_pieces
      FROM recipe_components WHERE id = NEW.component_id AND recipe_id = v_recipe;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'component does not belong to the order recipe' USING ERRCODE = 'GK422';
    END IF;
    IF NEW.component_name <> v_name OR NEW.expected_qty <> v_target * v_pieces THEN
      RAISE EXCEPTION 'item name and expected_qty must match the recipe and target_qty' USING ERRCODE = 'GK422';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 1. Approval guard: count only items that match the order's recipe components
-- ---------------------------------------------------------------------
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
    FROM cutting_orders WHERE id = NEW.order_id
    FOR UPDATE;

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
    -- Only items of this recipe's components count (items are unique per component and attempt).
    SELECT count(*),
           count(*) FILTER (WHERE vi.actual_qty IS NOT NULL),
           count(*) FILTER (WHERE vi.status::text = 'RED' OR vi.actual_qty < vi.expected_qty)
      INTO v_rows, v_counted, v_red
      FROM verification_items vi
      JOIN recipe_components rc ON rc.id = vi.component_id AND rc.recipe_id = v_recipe
      WHERE vi.order_id = NEW.order_id AND vi.attempt_no = NEW.attempt_no;

    IF v_rows <> v_components OR v_counted <> v_components OR v_red > 0 THEN
      RAISE EXCEPTION 'cannot approve: components missing, uncounted, or RED' USING ERRCODE = 'GK422';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 3 + 4. Order update guard: active sewing supervisor, immutable batch definition
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION gk_order_update_guard() RETURNS trigger AS $$
DECLARE
  v_role text;
  v_active boolean;
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
      SELECT role::text, is_active INTO v_role, v_active FROM users WHERE id = NEW.sewing_started_by;
      IF v_role IS DISTINCT FROM 'sewing_supervisor' OR NOT COALESCE(v_active, false) THEN
        RAISE EXCEPTION 'sewing_started_by must be an active sewing_supervisor' USING ERRCODE = 'GK403';
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

  -- The batch definition never changes: the items' expected_qty snapshots depend on it.
  IF NEW.recipe_id <> OLD.recipe_id OR
     NEW.target_qty <> OLD.target_qty OR
     NEW.fabric_roll_id <> OLD.fabric_roll_id OR
     NEW.order_no <> OLD.order_no OR
     NEW.created_by <> OLD.created_by THEN
    RAISE EXCEPTION 'the batch definition of an order is immutable' USING ERRCODE = 'GK409';
  END IF;

  -- Fabric used can be corrected only while the order is back with the supervisor for re-cutting.
  IF NEW.actual_fabric_yds <> OLD.actual_fabric_yds AND OLD.status::text <> 'REJECTED' THEN
    RAISE EXCEPTION 'actual_fabric_yds can only change while the order is rejected' USING ERRCODE = 'GK409';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
