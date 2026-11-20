-- migrate:up

ALTER TABLE pull_request_enhanced_stats
ADD COLUMN IF NOT EXISTS ai_assisted_model text;

-- migrate:down

ALTER TABLE pull_request_enhanced_stats
DROP COLUMN IF EXISTS ai_assisted_model;
