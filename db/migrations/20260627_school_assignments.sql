BEGIN;

CREATE TABLE school_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,

    class_id UUID NOT NULL REFERENCES school_classes(id) ON DELETE CASCADE,

    subject_id UUID NOT NULL REFERENCES school_subjects(id) ON DELETE CASCADE,

    teacher_member_id UUID NOT NULL REFERENCES school_members(id) ON DELETE SET NULL,

    title TEXT NOT NULL,

    description TEXT,

    assignment_type TEXT NOT NULL DEFAULT 'assignment'
        CHECK (
            assignment_type IN (
                'assignment',
                'homework',
                'project',
                'practical',
                'essay'
            )
        ),

    instructions TEXT,

    total_marks NUMERIC(5,2) NOT NULL DEFAULT 100,

    pass_mark NUMERIC(5,2) NOT NULL DEFAULT 40,

    start_at TIMESTAMP,

    due_at TIMESTAMP,

    allow_late_submission BOOLEAN DEFAULT FALSE,

    late_penalty NUMERIC(5,2) DEFAULT 0,

    visibility TEXT DEFAULT 'class'
        CHECK (
            visibility IN (
                'class',
                'school'
            )
        ),

    status TEXT DEFAULT 'draft'
        CHECK (
            status IN (
                'draft',
                'published',
                'closed',
                'archived'
            )
        ),

    created_at TIMESTAMP DEFAULT NOW(),

    updated_at TIMESTAMP DEFAULT NOW(),

    deleted_at TIMESTAMP
);

CREATE INDEX idx_school_assignments_school
ON school_assignments(school_id);

CREATE INDEX idx_school_assignments_class
ON school_assignments(class_id);

CREATE INDEX idx_school_assignments_subject
ON school_assignments(subject_id);

CREATE INDEX idx_school_assignments_teacher
ON school_assignments(teacher_member_id);

CREATE INDEX idx_school_assignments_status
ON school_assignments(status);

COMMIT;
