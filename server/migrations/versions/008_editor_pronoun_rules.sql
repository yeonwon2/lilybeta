-- Rules are book-level context shared by every chapter in the Beta reader.
ALTER TABLE beta_books ADD COLUMN pronoun_rules TEXT NOT NULL DEFAULT '[]';
ALTER TABLE beta_books ADD COLUMN contextual_pronoun_rules TEXT NOT NULL DEFAULT '[]';
