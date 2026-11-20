-- migrate:up
-- Match String.trim() whitespace, not just PostgreSQL trim's default ASCII space.
CREATE FUNCTION auth_normalized_username(value TEXT) RETURNS TEXT
LANGUAGE SQL IMMUTABLE STRICT PARALLEL SAFE AS $$
  SELECT lower(btrim(value, U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))
$$;

-- Block concurrent account creation during the duplicate check and index build.
LOCK TABLE auth_users IN SHARE ROW EXCLUSIVE MODE;
DO $$
BEGIN
  IF EXISTS (
    SELECT auth_normalized_username(username)
    FROM auth_users
    GROUP BY auth_normalized_username(username)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Normalized auth usernames are duplicated. Resolve duplicates explicitly before applying this migration; no accounts were merged or deleted.';
  END IF;
END $$;

CREATE UNIQUE INDEX auth_users_normalized_username_key
  ON auth_users (auth_normalized_username(username));

-- migrate:down
DROP INDEX auth_users_normalized_username_key;
DROP FUNCTION auth_normalized_username(TEXT);
