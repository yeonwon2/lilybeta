-- Rules are book-level context shared by every chapter in the Beta reader.
ALTER TABLE beta_books ADD COLUMN IF NOT EXISTS pronoun_rules TEXT NOT NULL DEFAULT '[]';
ALTER TABLE beta_books ADD COLUMN IF NOT EXISTS contextual_pronoun_rules TEXT NOT NULL DEFAULT '[]';
