import {
  AuthRepository,
  AuthUserRecord,
  CreateAuthUserParams,
} from "./authRepository.ts";
import { SqlClient } from "./sqlClient.ts";

type RawAuthUserRow = {
  auth_user_id: string;
  username: string;
  password_hash: string | null;
  bearer_token: string;
  role: string; // hydrated via JOIN
  is_active: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

export class PostgresAuthRepository implements AuthRepository {
  private readonly sql: SqlClient;

  constructor(sql: SqlClient) {
    this.sql = sql;
  }

  async close(): Promise<void> {
    // No-op: caller owns SqlClient lifecycle
  }

  async getAllUsers(): Promise<AuthUserRecord[]> {
    const rows = await this.sql<RawAuthUserRow[]>`
      SELECT
        u.auth_user_id,
        u.username,
        u.password_hash,
        u.bearer_token,
        r.role,
        u.is_active,
        u.created_at,
        u.updated_at
      FROM auth_users u
      JOIN auth_roles r ON r.auth_role_id = u.auth_role_id
      WHERE u.is_active = TRUE
      ORDER BY u.username
    `;
    return rows.map((row) => this.mapRow(row));
  }

  async findUserByToken(token: string): Promise<AuthUserRecord | null> {
    // bearer_token is a UUID column; malformed credentials should simply fail auth.
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        token,
      )
    )
      return null;
    const rows = await this.sql<RawAuthUserRow[]>`
      SELECT u.*, r.role FROM auth_users u
      JOIN auth_roles r ON r.auth_role_id = u.auth_role_id
      WHERE u.bearer_token = ${token} AND u.is_active = TRUE
      LIMIT 1
    `;
    return rows[0] ? this.mapRow(rows[0]) : null;
  }

  async insertUser(params: CreateAuthUserParams): Promise<AuthUserRecord> {
    const rows = await this.sql<RawAuthUserRow[]>`
      INSERT INTO auth_users (
        auth_user_id,
        username,
        password_hash,
        bearer_token,
        auth_role_id,
        is_active
      ) VALUES (
        ${params.userId},
        ${params.username},
        ${params.passwordHash},
        ${params.bearerToken},
        (SELECT auth_role_id FROM auth_roles WHERE role = ${params.role}),
        ${params.isActive}
      )
      RETURNING
        auth_user_id,
        username,
        password_hash,
        bearer_token,
        (SELECT role FROM auth_roles WHERE auth_role_id = auth_users.auth_role_id) AS role,
        is_active,
        created_at,
        updated_at
    `;
    return this.mapRow(rows[0]);
  }

  private mapRow(row: RawAuthUserRow): AuthUserRecord {
    const createdAt =
      row.created_at instanceof Date
        ? row.created_at
        : new Date(row.created_at);
    const updatedAt =
      row.updated_at instanceof Date
        ? row.updated_at
        : new Date(row.updated_at);

    return {
      userId: row.auth_user_id,
      username: row.username,
      passwordHash: row.password_hash,
      bearerToken: row.bearer_token,
      role: row.role,
      isActive: row.is_active,
      createdAt,
      updatedAt,
    };
  }
}
