-- Cue booking MVP — extensions
-- Requires Postgres 13+ (tstzrange + gist exclusion)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "btree_gist"; -- EXCLUDE constraints on uuid + range
