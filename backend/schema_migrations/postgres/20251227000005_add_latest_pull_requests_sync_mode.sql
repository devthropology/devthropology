-- migrate:up

INSERT INTO sync_modes (code, description)
VALUES (
    'LATEST_PULL_REQUESTS',
    'Backfill from the most recent pull requests (skip open issues)'
)
ON CONFLICT (code) DO NOTHING;

-- migrate:down

DELETE FROM sync_modes
WHERE code = 'LATEST_PULL_REQUESTS';
