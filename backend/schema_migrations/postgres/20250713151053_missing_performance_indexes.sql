-- migrate:up

CREATE INDEX idx_pull_request_file_pull_request ON pull_request_file (pull_request_id);
CREATE INDEX pull_request_review_user_id_idx ON pull_request_review (user_id);
CREATE INDEX pull_request_comment_user_id_idx ON pull_request_comment (user_id);
CREATE INDEX issue_comment_user_id_idx ON issue_comment (user_id);

-- migrate:down

