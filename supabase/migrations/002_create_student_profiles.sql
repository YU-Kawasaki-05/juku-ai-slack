CREATE TABLE student_profiles (
  id                UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  person_id         UUID        NOT NULL REFERENCES persons(id),
  summary           TEXT,
  learning_style    TEXT,
  strengths         TEXT,
  weaknesses        TEXT,
  instruction_notes TEXT,
  exam_mode_until   TIMESTAMPTZ,
  exam_subjects     TEXT[],
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT uq_student_profiles_person_id UNIQUE (person_id)
);

CREATE UNIQUE INDEX idx_student_profiles_person_id ON student_profiles (person_id);
