BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM exam_live_study_workspace_events
    LIMIT 1
  )
  OR EXISTS (
    SELECT 1
    FROM exam_live_study_revision_submissions
    LIMIT 1
  )
  OR EXISTS (
    SELECT 1
    FROM exam_live_study_revision_notes
    LIMIT 1
  )
  OR EXISTS (
    SELECT 1
    FROM exam_live_study_revision_activities
    LIMIT 1
  )
  OR EXISTS (
    SELECT 1
    FROM exam_live_study_workspaces
    LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'Refusing Live Study workspace rollback because workspace data exists';
  END IF;
END
$$;

DROP TABLE IF EXISTS
  exam_live_study_revision_notes;

DROP TABLE IF EXISTS
  exam_live_study_revision_submissions;

DROP TABLE IF EXISTS
  exam_live_study_revision_activities;

DROP TABLE IF EXISTS
  exam_live_study_workspace_events;

DROP TABLE IF EXISTS
  exam_live_study_workspaces;

COMMIT;
