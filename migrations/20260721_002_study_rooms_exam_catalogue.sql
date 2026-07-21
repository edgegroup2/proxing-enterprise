BEGIN;

-- Prevent concurrent Study Room writes while the constraint is replaced.
LOCK TABLE study_rooms
  IN SHARE ROW EXCLUSIVE MODE;

-- Fail closed if the table already contains an unknown exam code.
DO $migration$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM study_rooms
    WHERE exam_type IS NULL
       OR exam_type NOT IN (
         'jamb',
         'waec',
         'neco',
         'ielts',
         'sat',
         'gre',
         'toefl',
         'cfa'
       )
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE =
        'study_rooms contains an unsupported exam_type';
  END IF;
END;
$migration$;

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
      'ielts',
      'sat',
      'gre',
      'toefl',
      'cfa'
    )
  )
  NOT VALID;

ALTER TABLE study_rooms
  VALIDATE CONSTRAINT
    study_rooms_exam_type_check;

COMMIT;
