-- Add file types by LOC column and rename existing top_file_types column
-- migrate:up

-- Add the new column for file types by LOC
ALTER TABLE computed_repository_overview 
ADD COLUMN top_file_types_by_loc jsonb;

-- Rename the existing column to be more specific about counting
ALTER TABLE computed_repository_overview 
RENAME COLUMN top_file_types TO top_file_types_by_count;

-- Update the comments for clarity
COMMENT ON COLUMN computed_repository_overview.top_file_types_by_count IS 'JSON array of top file extensions by count: [{"extension": "ts", "count": 1234}, ...]';
COMMENT ON COLUMN computed_repository_overview.top_file_types_by_loc IS 'JSON array of top file extensions by lines of code: [{"extension": "ts", "loc": 50000}, ...]';

-- migrate:down
ALTER TABLE computed_repository_overview 
RENAME COLUMN top_file_types_by_count TO top_file_types;

ALTER TABLE computed_repository_overview 
DROP COLUMN top_file_types_by_loc;