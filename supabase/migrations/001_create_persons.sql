CREATE TABLE persons (
  id           UUID         NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name         VARCHAR(100) NOT NULL,
  display_name VARCHAR(100),
  grade        VARCHAR(50),
  status       VARCHAR(20)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  guardian_email VARCHAR(255),
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_persons_status ON persons (status);
