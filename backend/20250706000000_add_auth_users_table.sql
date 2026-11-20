-- migrate:up

-- -- Add auth users table for future authentication expansion
-- -- This table will replace the hardcoded users in the backend when migrating to proper auth

-- CREATE TABLE IF NOT EXISTS auth_users (
--     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
--     username VARCHAR(255) NOT NULL UNIQUE,
--     password_hash VARCHAR(255) NOT NULL,
--     role VARCHAR(50) NOT NULL DEFAULT 'guest',
--     created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
--     updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
--     is_active BOOLEAN DEFAULT true
-- );

-- -- Create index for efficient username lookups
-- CREATE INDEX IF NOT EXISTS idx_auth_users_username ON auth_users(username);
-- CREATE INDEX IF NOT EXISTS idx_auth_users_active ON auth_users(is_active);

-- -- Insert the hardcoded users with hashed passwords (using bcrypt hash for 'password123' format)
-- -- Note: These are placeholder hashes - in production, use proper bcrypt hashing
-- INSERT INTO auth_users (username, password_hash, role) VALUES
--     ('admin', '$2b$10$placeholder_hash_for_admin123', 'admin'),
--     ('guest1', '$2b$10$placeholder_hash_for_guest123', 'guest'),
--     ('guest2', '$2b$10$placeholder_hash_for_guest456', 'guest')
-- ON CONFLICT (username) DO NOTHING;

-- -- Add comments for future reference
-- COMMENT ON TABLE auth_users IS 'Authentication users table for replacing hardcoded auth';
-- COMMENT ON COLUMN auth_users.password_hash IS 'Bcrypt hashed password';
-- COMMENT ON COLUMN auth_users.role IS 'User role: admin, guest, etc.';

-- migrate:down