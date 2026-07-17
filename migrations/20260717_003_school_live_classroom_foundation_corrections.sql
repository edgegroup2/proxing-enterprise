BEGIN;

ALTER TABLE IF EXISTS
  school_live_classroom_policies
DROP CONSTRAINT IF EXISTS
  school_live_classroom_recording_disabled_initially_check;

COMMIT;
