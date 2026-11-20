-- migrate:up

-- Create Demo workspace (for showcase repositories)
INSERT INTO workspace (workspace_id, name, slug, workspace_type, created_by)
VALUES (
  'a0000000-0000-0000-0000-000000000001',
  'Demo',
  'demo',
  'demo',
  NULL
) ON CONFLICT (slug) DO NOTHING;

-- Create Testing workspace (for superuser-only testing repos)
INSERT INTO workspace (workspace_id, name, slug, workspace_type, created_by)
VALUES (
  'a0000000-0000-0000-0000-000000000002',
  'Testing',
  'testing',
  'system',
  NULL
) ON CONFLICT (slug) DO NOTHING;

-- Add explicit demo repositories to Demo workspace
-- These are the curated showcase repos (getsentry/*, posthog/*, supabase/*)
INSERT INTO workspace_repository (workspace_id, repository_id, added_by)
SELECT 
  'a0000000-0000-0000-0000-000000000001'::UUID,
  r.repository_id,
  NULL
FROM repository r
WHERE (r.org, r.name) IN (
  ('getsentry', 'relay'),
  ('getsentry', 'sentry'),
  ('getsentry', 'spotlight'),
  ('getsentry', 'snuba'),
  ('posthog', 'posthog'),
  ('posthog', 'posthog.com'),
  ('supabase', 'realtime'),
  ('supabase', 'supabase')
)
ON CONFLICT (workspace_id, repository_id) DO NOTHING;

-- Add testing repositories to Testing workspace (superuser only)
INSERT INTO workspace_repository (workspace_id, repository_id, added_by)
SELECT 
  'a0000000-0000-0000-0000-000000000002'::UUID,
  r.repository_id,
  NULL
FROM repository r
WHERE r.org = 'testing'
ON CONFLICT (workspace_id, repository_id) DO NOTHING;

-- migrate:down
DELETE FROM workspace_repository WHERE workspace_id IN (
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002'
);
DELETE FROM workspace WHERE slug IN ('demo', 'testing');
