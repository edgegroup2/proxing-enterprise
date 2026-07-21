BEGIN;

-- This rollback removes only the Exam Prep Live Study foundation.
-- It deliberately avoids CASCADE so unexpected external dependencies
-- cause the rollback to fail safely instead of deleting unrelated objects.
--
-- Back up any Live Study session history before using this rollback
-- after the feature has accepted real traffic.

DROP TABLE IF EXISTS exam_live_study_events;

DROP TABLE IF EXISTS exam_live_study_participants;

DROP TABLE IF EXISTS exam_live_study_sessions;

COMMIT;
