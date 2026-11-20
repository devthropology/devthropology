-- migrate:up
ALTER TABLE pull_request_comment
    ADD COLUMN gh_pull_request_review_id bigint,
    ADD COLUMN gh_in_reply_to_comment_id bigint,
    ADD COLUMN line integer,
    ADD COLUMN start_line integer,
    ADD COLUMN original_line integer,
    ADD COLUMN original_start_line integer,
    ADD COLUMN side text,
    ADD COLUMN start_side text,
    ADD COLUMN subject_type text,
    ADD COLUMN commit_id text,
    ADD COLUMN original_commit_id text,
    ADD COLUMN diff_hunk text,
    ADD COLUMN reactions jsonb,
    ADD COLUMN reactions_observed_at timestamptz;

ALTER TABLE pull_request_review ADD COLUMN commit_id text;

-- migrate:down
ALTER TABLE pull_request_review DROP COLUMN commit_id;

ALTER TABLE pull_request_comment
    DROP COLUMN reactions_observed_at,
    DROP COLUMN reactions,
    DROP COLUMN diff_hunk,
    DROP COLUMN original_commit_id,
    DROP COLUMN commit_id,
    DROP COLUMN subject_type,
    DROP COLUMN start_side,
    DROP COLUMN side,
    DROP COLUMN original_start_line,
    DROP COLUMN original_line,
    DROP COLUMN start_line,
    DROP COLUMN line,
    DROP COLUMN gh_in_reply_to_comment_id,
    DROP COLUMN gh_pull_request_review_id;
