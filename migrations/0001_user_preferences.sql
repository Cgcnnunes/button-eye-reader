CREATE TABLE IF NOT EXISTS user_preferences (
  access_subject TEXT PRIMARY KEY NOT NULL,
  board TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);
