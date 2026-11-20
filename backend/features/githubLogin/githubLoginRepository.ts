import type { SqlClient } from "../../repository/sqlClient.ts";

export interface LoginAttempt {
  codeVerifier: string;
  redirectTo: string;
}

export interface ProvisionedAccount {
  userId: string;
  username: string;
  role: string;
  token: string;
  isNew: boolean;
}

type ExistingAccountRow = {
  auth_user_id: string;
  username: string;
  bearer_token: string;
  is_active: boolean;
  role: string;
};

export class GithubLoginRepository {
  constructor(private readonly sql: SqlClient) {}

  async saveAttempt(
    stateHash: string,
    browserHash: string,
    verifier: string,
    redirectTo: string,
  ) {
    await this.sql`DELETE FROM github_login_attempt WHERE expires_at < now()`;
    await this.sql`
      INSERT INTO github_login_attempt (state_hash, browser_hash, code_verifier, redirect_to)
      VALUES (${stateHash}, ${browserHash}, ${verifier}, ${redirectTo})
    `;
  }

  async consumeAttempt(
    stateHash: string,
    browserHash: string,
  ): Promise<LoginAttempt | null> {
    const rows = await this.sql<LoginAttempt[]>`
      DELETE FROM github_login_attempt
      WHERE state_hash = ${stateHash} AND browser_hash = ${browserHash} AND expires_at > now()
      RETURNING code_verifier AS "codeVerifier", redirect_to AS "redirectTo"
    `;
    return rows[0] ?? null;
  }

  async provision(
    githubId: string,
    login: string,
  ): Promise<ProvisionedAccount | null> {
    return await this.sql.begin(async (sql) => {
      // Serialize callbacks for the same stable identity across application instances.
      await sql`SELECT pg_advisory_xact_lock(hashtextextended(${`github:${githubId}`}, 0))`;
      const existing = await sql<ExistingAccountRow[]>`
        SELECT u.auth_user_id, u.username, u.bearer_token, u.is_active, r.role
        FROM github_identity i JOIN auth_users u ON u.auth_user_id = i.auth_user_id
        JOIN auth_roles r ON r.auth_role_id = u.auth_role_id
        WHERE i.github_user_id = ${githubId}
      `;
      if (existing[0]) {
        const user = existing[0];
        if (!user.is_active) return null;
        await sql`UPDATE github_identity SET github_login = ${login} WHERE github_user_id = ${githubId}`;
        return {
          userId: user.auth_user_id,
          username: user.username,
          role: user.role,
          token: user.bearer_token,
          isNew: false,
        };
      }
      const userId = crypto.randomUUID();
      const token = crypto.randomUUID();
      // Let the database arbitrate normalized names across every creation path,
      // including password services with stale caches. Never merge accounts.
      const fallbackName = `${login}-gh-${userId}`;
      let username = login;
      const insertAccount = (name: string) =>
        sql`
        INSERT INTO auth_users (auth_user_id, username, password_hash, bearer_token, auth_role_id, is_active)
        VALUES (${userId}, ${name}, NULL, ${token},
          (SELECT auth_role_id FROM auth_roles WHERE role = 'user'), TRUE)
        ON CONFLICT (auth_normalized_username(username)) DO NOTHING
        RETURNING auth_user_id
      `;
      // An existing or concurrently created normalized name uses a unique suffix.
      if (!(await insertAccount(username)).length) {
        username = fallbackName;
        if (!(await insertAccount(username)).length) {
          throw new Error("Unable to allocate account name");
        }
      }
      await sql`
        INSERT INTO github_identity (github_user_id, auth_user_id, github_login)
        VALUES (${githubId}, ${userId}, ${login})
      `;
      const workspaceId = crypto.randomUUID();
      await sql`
        INSERT INTO workspace (workspace_id, name, slug, workspace_type, created_by)
        VALUES (${workspaceId}, ${`${login}'s workspace`}, ${`github-${userId}`}, 'user', ${userId})
      `;
      await sql`
        INSERT INTO workspace_member (workspace_id, auth_user_id, workspace_role)
        VALUES (${workspaceId}, ${userId}, 'owner')
      `;
      return { userId, username, role: "user", token, isNew: true };
    });
  }
}
