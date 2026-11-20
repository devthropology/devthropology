-- migrate:up

CREATE TABLE IF NOT EXISTS teams (
    team_id bigserial PRIMARY KEY,
    repository_id bigint NOT NULL REFERENCES repository (repository_id) ON DELETE CASCADE,
    name text NOT NULL,
    slug text NOT NULL,
    source_type text NOT NULL CHECK (source_type IN ('manual', 'github')),
    gh_team_id bigint,
    gh_org_login text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (repository_id, slug)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_team_repository_gh_team_id
    ON teams (repository_id, gh_team_id);

CREATE INDEX IF NOT EXISTS idx_team_repository_source
    ON teams (repository_id, source_type);

CREATE TABLE IF NOT EXISTS team_members (
    team_member_id bigserial PRIMARY KEY,
    team_id bigint NOT NULL REFERENCES teams (team_id) ON DELETE CASCADE,
    user_id bigint NOT NULL REFERENCES "user" (user_id) ON DELETE CASCADE,
    member_role text CHECK (member_role IN ('member', 'maintainer')),
    source_type text NOT NULL CHECK (source_type IN ('manual', 'github')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (team_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_team_member_team_id
    ON team_members (team_id);

CREATE INDEX IF NOT EXISTS idx_team_member_user_id
    ON team_members (user_id);

INSERT INTO sync_modes (code, description)
VALUES (
    'SYNC_GITHUB_TEAMS',
    'Import GitHub teams for the repository and sync their members'
)
ON CONFLICT (code) DO NOTHING;

-- migrate:down

DROP INDEX IF EXISTS idx_team_member_user_id;
DROP INDEX IF EXISTS idx_team_member_team_id;
DROP TABLE IF EXISTS team_members;
DROP INDEX IF EXISTS idx_team_repository_source;
DROP INDEX IF EXISTS idx_team_repository_gh_team_id;
DROP TABLE IF EXISTS teams;
DELETE FROM sync_modes
WHERE code = 'SYNC_GITHUB_TEAMS';
