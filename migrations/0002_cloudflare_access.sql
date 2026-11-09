CREATE TABLE user_preferences (
  access_subject TEXT PRIMARY KEY NOT NULL,
  board TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0)
);

CREATE TABLE legacy_board_archive (
  id TEXT PRIMARY KEY NOT NULL,
  username TEXT NOT NULL,
  board TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 0)
);

INSERT INTO legacy_board_archive (id, username, board, revision)
SELECT id, username, board, revision FROM accounts;

DROP TABLE sessions;
DROP TABLE account_tokens;
DROP TABLE login_limits;
DROP TABLE accounts;
