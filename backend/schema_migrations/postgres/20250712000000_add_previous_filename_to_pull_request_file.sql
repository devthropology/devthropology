-- migrate:up

-- Add previous_filename column to pull_request_file table
-- This column stores the original filename when a file is renamed (status = 'renamed')
ALTER TABLE pull_request_file 
    ADD COLUMN previous_filename text;

-- migrate:down

-- Remove the previous_filename column
ALTER TABLE pull_request_file 
    DROP COLUMN previous_filename;