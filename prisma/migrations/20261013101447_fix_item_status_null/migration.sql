-- Fix: a counted item with a NULL status slipped through chk_items_status_matches
-- (a CHECK that evaluates to NULL passes), and the approval guard only looked at the
-- stored status, so a zero-count component with status NULL could be approved.

-- 1. A counted item must carry a status, and an uncounted item must not.
ALTER TABLE verification_items DROP CONSTRAINT chk_items_status_matches;
ALTER TABLE verification_items
  ADD CONSTRAINT chk_items_status_matches CHECK (
    (actual_qty IS NULL AND status IS NULL) OR
    (actual_qty IS NOT NULL AND status IS NOT NULL AND (
      (actual_qty = expected_qty AND status = 'GREEN')  OR
      (actual_qty > expected_qty AND status = 'YELLOW') OR
      (actual_qty < expected_qty AND status = 'RED')
    ))
  );

-- 2. Defence in depth: the approval guard recomputes shortages from the quantities
--    instead of trusting the stored status. Only the RED count line changes.
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
           count(*) FILTER (WHERE status::text = 'RED' OR actual_qty < expected_qty)
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
