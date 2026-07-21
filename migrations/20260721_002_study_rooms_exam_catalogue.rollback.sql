BEGIN;

-- Prevent concurrent Study Room writes during rollback validation.
LOCK TABLE study_rooms
  IN SHARE ROW EXCLUSIVE MODE;

-- Refuse rollback while rooms use any newly enabled exam type.
-- This avoids deleting data or leaving existing rows invalid.
DO $rollback$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM study_rooms
    WHERE exam_type IN (
      'ielts',
      'gre',
      'toefl',
      'cfa'
    )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE =
        'rollback refused: IELTS, GRE, TOEFL or CFA Study Rooms exist';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM study_rooms
    WHERE exam_type IS NULL
       OR exam_type NOT IN (
         'jamb',
         'waec',
         'neco',
         'sat'
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE =
        'rollback refused: study_rooms contains unsupported exam_type values';
  END IF;
END;
$rollback$;

ALTER TABLE study_rooms
  DROP CONSTRAINT IF EXISTS
    study_rooms_exam_type_check;

ALTER TABLE study_rooms
  ADD CONSTRAINT study_rooms_exam_type_check
  CHECK (
    exam_type IN (
      'jamb',
      'waec',
      'neco',
      'sat'
    )
  )
  NOT VALID;

ALTER TABLE study_rooms
  VALIDATE CONSTRAINT
    study_rooms_exam_type_check;

COMMIT;
