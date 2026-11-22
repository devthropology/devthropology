-- migrate:up
-- NULL preserves legacy classification until a user is observed in a GitHub sync.
ALTER TABLE "user" ADD COLUMN gh_type text;

-- migrate:down
ALTER TABLE "user" DROP COLUMN gh_type;
