-- migrate:up

-- Workspace: represents a tenant (demo, testing, or user workspace)
CREATE TABLE IF NOT EXISTS workspace (
  workspace_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  workspace_type TEXT NOT NULL CHECK (workspace_type IN ('demo', 'system', 'user')),
  created_by UUID REFERENCES auth_users(auth_user_id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workspace_slug ON workspace(slug);
CREATE INDEX IF NOT EXISTS idx_workspace_type ON workspace(workspace_type);

-- Workspace membership: links users to workspaces with a role
CREATE TABLE IF NOT EXISTS workspace_member (
  workspace_id UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  auth_user_id UUID NOT NULL REFERENCES auth_users(auth_user_id) ON DELETE CASCADE,
  workspace_role TEXT NOT NULL DEFAULT 'member' CHECK (workspace_role IN ('owner', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, auth_user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_member_user ON workspace_member(auth_user_id);

-- Workspace repository: links repositories to workspaces
CREATE TABLE IF NOT EXISTS workspace_repository (
  workspace_id UUID NOT NULL REFERENCES workspace(workspace_id) ON DELETE CASCADE,
  repository_id BIGINT NOT NULL REFERENCES repository(repository_id) ON DELETE CASCADE,
  added_by UUID REFERENCES auth_users(auth_user_id) ON DELETE SET NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (workspace_id, repository_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_repository_repo ON workspace_repository(repository_id);

-- migrate:down
DROP TABLE IF EXISTS workspace_repository;
DROP TABLE IF EXISTS workspace_member;
DROP TABLE IF EXISTS workspace;
