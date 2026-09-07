ALTER TABLE beta_books ADD COLUMN IF NOT EXISTS narrative_pronoun_rules TEXT NOT NULL DEFAULT '[]';
