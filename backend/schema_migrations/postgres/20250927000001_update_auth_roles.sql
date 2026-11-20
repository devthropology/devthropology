-- migrate:up

UPDATE auth_roles
SET role = 'user'
WHERE role = 'reader';

INSERT INTO auth_roles (role)
VALUES ('demo')
ON CONFLICT (role) DO NOTHING;

-- migrate:down
UPDATE auth_roles
SET role = 'reader'
WHERE role = 'user';

DELETE FROM auth_roles
WHERE role = 'demo';
