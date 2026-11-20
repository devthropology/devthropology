import { z } from "zod";
import {
  Team,
  TeamAvailableUser,
  TeamAvailableUserSchema,
  TeamMember,
  TeamMemberRole,
  TeamMemberSchema,
  TeamSchema,
  TeamSourceType,
} from "../../../shared/models/team.ts";
import { SqlClient } from "../../repository/sqlClient.ts";
import { TeamNotFoundError } from "./teamsErrors.ts";

type TeamRow = {
  team_id: number | string;
  repository_id: number | string;
  name: string;
  slug: string;
  source_type: TeamSourceType;
  gh_team_id: number | string | null;
  gh_org_login: string | null;
  member_count: number | string;
  created_at: string | Date;
  updated_at: string | Date;
};

type TeamMemberRow = {
  team_member_id: number | string;
  team_id: number | string;
  user_id: number | string;
  gh_login: string;
  member_role: TeamMemberRole | null;
  source_type: TeamSourceType;
  created_at: string | Date;
  updated_at: string | Date;
};

type TeamAvailableUserRow = {
  user_id: number | string;
  gh_login: string;
};

type TeamMemberLoginRow = {
  gh_login: string;
};

type GithubTeamUpsertParams = {
  repositoryId: number;
  name: string;
  slug: string;
  ghTeamId: number;
  ghOrgLogin: string;
};

type GithubTeamMemberUpsert = {
  userId: number;
  role: TeamMemberRole;
};

export class PostgresTeamRepository {
  constructor(private readonly sql: SqlClient) {}

  async close(): Promise<void> {
    // No-op: caller owns SqlClient lifecycle
  }

  async listTeams(repositoryId: number): Promise<Team[]> {
    const rows = await this.sql.unsafe<TeamRow[]>(
      `
        SELECT
          t.team_id,
          t.repository_id,
          t.name,
          t.slug,
          t.source_type,
          t.gh_team_id,
          t.gh_org_login,
          COUNT(tm.team_member_id) AS member_count,
          t.created_at,
          t.updated_at
        FROM teams t
        LEFT JOIN team_members tm ON tm.team_id = t.team_id
        WHERE t.repository_id = $1
        GROUP BY t.team_id
        ORDER BY t.source_type, t.name, t.team_id
      `,
      [repositoryId],
    );

    return z.array(TeamSchema).parse(rows.map((row) => this.mapTeamRow(row)));
  }

  async getTeamById(
    repositoryId: number,
    teamId: number,
  ): Promise<Team | null> {
    const rows = await this.sql.unsafe<TeamRow[]>(
      `
        SELECT
          t.team_id,
          t.repository_id,
          t.name,
          t.slug,
          t.source_type,
          t.gh_team_id,
          t.gh_org_login,
          COUNT(tm.team_member_id) AS member_count,
          t.created_at,
          t.updated_at
        FROM teams t
        LEFT JOIN team_members tm ON tm.team_id = t.team_id
        WHERE t.repository_id = $1
          AND t.team_id = $2
        GROUP BY t.team_id
        LIMIT 1
      `,
      [repositoryId, teamId],
    );

    if (rows.length === 0) {
      return null;
    }

    return TeamSchema.parse(this.mapTeamRow(rows[0]));
  }

  async getTeamMembers(
    repositoryId: number,
    teamId: number,
  ): Promise<TeamMember[]> {
    return await this.getTeamMembersWithExecutor(
      this.sql,
      repositoryId,
      teamId,
    );
  }

  async listAvailableUsers(repositoryId: number): Promise<TeamAvailableUser[]> {
    const rows = await this.sql.unsafe<TeamAvailableUserRow[]>(
      `
        SELECT u.user_id, u.gh_login
        FROM user_activity ua
        INNER JOIN "user" u ON u.user_id = ua.user_id
        WHERE ua.repository_id = $1
        ORDER BY u.gh_login ASC
      `,
      [repositoryId],
    );

    return z.array(TeamAvailableUserSchema).parse(
      rows.map((row) => ({
        userId: Number(row.user_id),
        ghLogin: row.gh_login,
      })),
    );
  }

  async listMemberLoginsByTeamSlugs(
    repositoryId: number,
    teamSlugs: string[],
  ): Promise<string[]> {
    const normalizedSlugs = Array.from(
      new Set(teamSlugs.map((slug) => slug.trim()).filter(Boolean)),
    );
    if (normalizedSlugs.length === 0) {
      return [];
    }

    const rows = await this.sql.unsafe<TeamMemberLoginRow[]>(
      `
        SELECT DISTINCT u.gh_login
        FROM teams t
        INNER JOIN team_members tm ON tm.team_id = t.team_id
        INNER JOIN "user" u ON u.user_id = tm.user_id
        WHERE t.repository_id = $1
          AND t.slug = ANY($2::text[])
        ORDER BY u.gh_login ASC
      `,
      [repositoryId, normalizedSlugs],
    );

    return rows.map((row) => row.gh_login);
  }

  async getExistingUserIds(userIds: number[]): Promise<Set<number>> {
    if (userIds.length === 0) {
      return new Set();
    }

    const rows = await this.sql.unsafe<{ user_id: number | string }[]>(
      `SELECT user_id FROM "user" WHERE user_id = ANY($1::bigint[])`,
      [userIds],
    );

    return new Set(rows.map((row) => Number(row.user_id)));
  }

  async createManualTeam(
    repositoryId: number,
    name: string,
    userIds: number[],
  ): Promise<Team> {
    return await this.sql.begin(async (tx) => {
      const slug = await this.generateUniqueSlug(tx, repositoryId, name);
      const rows = await tx.unsafe<TeamRow[]>(
        `
          INSERT INTO teams (
            repository_id,
            name,
            slug,
            source_type
          )
          VALUES ($1, $2, $3, 'manual')
          RETURNING
            team_id,
            repository_id,
            name,
            slug,
            source_type,
            gh_team_id,
            gh_org_login,
            0::bigint AS member_count,
            created_at,
            updated_at
        `,
        [repositoryId, name.trim(), slug],
      );

      const team = this.mapTeamRow(rows[0]);
      await this.replaceTeamMembersTx(tx, team.teamId, userIds, "manual");

      const createdTeam = await this.getTeamByIdWithExecutor(
        tx,
        repositoryId,
        team.teamId,
      );
      if (!createdTeam) {
        throw new Error("Failed to load created team");
      }
      return createdTeam;
    });
  }

  async updateTeam(
    repositoryId: number,
    teamId: number,
    name: string,
  ): Promise<Team> {
    return await this.sql.begin(async (tx) => {
      const slug = await this.generateUniqueSlug(
        tx,
        repositoryId,
        name,
        teamId,
      );
      await tx.unsafe(
        `
          UPDATE teams
          SET name = $1,
              slug = $2,
              updated_at = now()
          WHERE repository_id = $3
            AND team_id = $4
        `,
        [name.trim(), slug, repositoryId, teamId],
      );

      const updated = await this.getTeamByIdWithExecutor(
        tx,
        repositoryId,
        teamId,
      );
      if (!updated) {
        throw new Error("Failed to load updated team");
      }
      return updated;
    });
  }

  async replaceTeamMembers(
    repositoryId: number,
    teamId: number,
    userIds: number[],
  ): Promise<TeamMember[]> {
    return await this.sql.begin(async (tx) => {
      await this.replaceTeamMembersTx(tx, teamId, userIds, "manual");
      return await this.getTeamMembersWithExecutor(tx, repositoryId, teamId);
    });
  }

  async upsertGithubTeam(params: GithubTeamUpsertParams): Promise<Team> {
    return await this.sql.begin(async (tx) => {
      const rows = await tx.unsafe<TeamRow[]>(
        `
          INSERT INTO teams (
            repository_id,
            name,
            slug,
            source_type,
            gh_team_id,
            gh_org_login
          )
          VALUES ($1, $2, $3, 'github', $4, $5)
          ON CONFLICT (repository_id, gh_team_id)
          DO UPDATE SET
            name = EXCLUDED.name,
            slug = EXCLUDED.slug,
            gh_org_login = EXCLUDED.gh_org_login,
            updated_at = now()
          RETURNING
            team_id,
            repository_id,
            name,
            slug,
            source_type,
            gh_team_id,
            gh_org_login,
            0::bigint AS member_count,
            created_at,
            updated_at
        `,
        [
          params.repositoryId,
          params.name,
          params.slug,
          params.ghTeamId,
          params.ghOrgLogin,
        ],
      );

      const teamId = Number(rows[0].team_id);
      const team = await this.getTeamByIdWithExecutor(
        tx,
        params.repositoryId,
        teamId,
      );
      if (!team) {
        throw new Error("Failed to load upserted GitHub team");
      }
      return team;
    });
  }

  async replaceGithubTeamMembers(
    repositoryId: number,
    teamId: number,
    members: GithubTeamMemberUpsert[],
  ): Promise<TeamMember[]> {
    const dedupedMembers = dedupeGithubMembers(members);

    return await this.sql.begin(async (tx) => {
      const team = await this.getTeamByIdWithExecutor(tx, repositoryId, teamId);
      if (!team) {
        throw new TeamNotFoundError(repositoryId, teamId);
      }
      if (team.sourceType !== "github") {
        throw new Error(
          "Can only replace GitHub members for GitHub-backed teams",
        );
      }

      const targetUserIds = dedupedMembers.map((member) => member.userId);
      await tx.unsafe(
        `
          DELETE FROM team_members
          WHERE team_id = $1
            AND user_id <> ALL($2::bigint[])
        `,
        [teamId, targetUserIds],
      );

      for (const member of dedupedMembers) {
        await tx.unsafe(
          `
            INSERT INTO team_members (
              team_id,
              user_id,
              member_role,
              source_type
            )
            VALUES ($1, $2, $3, 'github')
            ON CONFLICT (team_id, user_id)
            DO UPDATE SET
              member_role = EXCLUDED.member_role,
              source_type = EXCLUDED.source_type,
              updated_at = now()
          `,
          [teamId, member.userId, member.role],
        );
      }

      return await this.getTeamMembersWithExecutor(tx, repositoryId, teamId);
    });
  }

  private async replaceTeamMembersTx(
    executor: SqlClient,
    teamId: number,
    userIds: number[],
    sourceType: TeamSourceType,
  ): Promise<void> {
    await executor.unsafe(
      `
        DELETE FROM team_members
        WHERE team_id = $1
          AND user_id <> ALL($2::bigint[])
      `,
      [teamId, userIds],
    );

    for (const userId of userIds) {
      await executor.unsafe(
        `
          INSERT INTO team_members (
            team_id,
            user_id,
            member_role,
            source_type
          )
          VALUES ($1, $2, NULL, $3)
          ON CONFLICT (team_id, user_id)
          DO UPDATE SET
            member_role = EXCLUDED.member_role,
            source_type = EXCLUDED.source_type,
            updated_at = now()
        `,
        [teamId, userId, sourceType],
      );
    }
  }

  private async generateUniqueSlug(
    executor: SqlClient,
    repositoryId: number,
    name: string,
    excludedTeamId?: number,
  ): Promise<string> {
    const baseSlug = slugifyName(name);
    let slug = baseSlug;
    let suffix = 2;

    while (
      await this.slugExists(executor, repositoryId, slug, excludedTeamId)
    ) {
      slug = `${baseSlug}-${suffix}`;
      suffix++;
    }

    return slug;
  }

  private async slugExists(
    executor: SqlClient,
    repositoryId: number,
    slug: string,
    excludedTeamId?: number,
  ): Promise<boolean> {
    const rows = await executor.unsafe<{ exists: boolean }[]>(
      `
        SELECT EXISTS (
          SELECT 1
          FROM teams
          WHERE repository_id = $1
            AND slug = $2
            AND ($3::bigint IS NULL OR team_id <> $3)
        ) AS exists
      `,
      [repositoryId, slug, excludedTeamId ?? null],
    );
    return rows[0]?.exists ?? false;
  }

  private async getTeamByIdWithExecutor(
    executor: SqlClient,
    repositoryId: number,
    teamId: number,
  ): Promise<Team | null> {
    const rows = await executor.unsafe<TeamRow[]>(
      `
        SELECT
          t.team_id,
          t.repository_id,
          t.name,
          t.slug,
          t.source_type,
          t.gh_team_id,
          t.gh_org_login,
          COUNT(tm.team_member_id) AS member_count,
          t.created_at,
          t.updated_at
        FROM teams t
        LEFT JOIN team_members tm ON tm.team_id = t.team_id
        WHERE t.repository_id = $1
          AND t.team_id = $2
        GROUP BY t.team_id
        LIMIT 1
      `,
      [repositoryId, teamId],
    );

    if (rows.length === 0) {
      return null;
    }
    return TeamSchema.parse(this.mapTeamRow(rows[0]));
  }

  private async getTeamMembersWithExecutor(
    executor: SqlClient,
    repositoryId: number,
    teamId: number,
  ): Promise<TeamMember[]> {
    const rows = await executor.unsafe<TeamMemberRow[]>(
      `
        SELECT
          tm.team_member_id,
          tm.team_id,
          tm.user_id,
          u.gh_login,
          tm.member_role,
          tm.source_type,
          tm.created_at,
          tm.updated_at
        FROM team_members tm
        INNER JOIN teams t ON t.team_id = tm.team_id
        INNER JOIN "user" u ON u.user_id = tm.user_id
        WHERE t.repository_id = $1
          AND tm.team_id = $2
        ORDER BY u.gh_login ASC
      `,
      [repositoryId, teamId],
    );

    return z
      .array(TeamMemberSchema)
      .parse(rows.map((row) => this.mapTeamMemberRow(row)));
  }

  private mapTeamRow(row: TeamRow): Team {
    return {
      teamId: Number(row.team_id),
      repositoryId: Number(row.repository_id),
      name: row.name,
      slug: row.slug,
      sourceType: row.source_type,
      ghTeamId: row.gh_team_id === null ? null : Number(row.gh_team_id),
      ghOrgLogin: row.gh_org_login,
      memberCount: Number(row.member_count),
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
    };
  }

  private mapTeamMemberRow(row: TeamMemberRow): TeamMember {
    return {
      teamMemberId: Number(row.team_member_id),
      teamId: Number(row.team_id),
      userId: Number(row.user_id),
      ghLogin: row.gh_login,
      memberRole: row.member_role,
      sourceType: row.source_type,
      createdAt: toIsoString(row.created_at),
      updatedAt: toIsoString(row.updated_at),
    };
  }
}

function slugifyName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  return slug || "team";
}

function dedupeGithubMembers(
  members: GithubTeamMemberUpsert[],
): GithubTeamMemberUpsert[] {
  const byUserId = new Map<number, GithubTeamMemberUpsert>();
  for (const member of members) {
    if (member.userId > 0) {
      byUserId.set(member.userId, member);
    }
  }
  return Array.from(byUserId.values());
}

function toIsoString(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
