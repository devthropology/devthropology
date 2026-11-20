import type {
  CreateTeamRequest,
  Team,
  TeamAvailableUser,
  TeamMember,
  UpdateTeamRequest,
} from "../../../shared/models/team.ts";
import {
  TeamNotFoundError,
  TeamReadOnlyError,
  UnknownUserIdsError,
} from "./teamsErrors.ts";
import { PostgresTeamRepository } from "./teamsRepository.ts";

export class TeamsService {
  constructor(private readonly repository: PostgresTeamRepository) {}

  async listTeams(repositoryId: number): Promise<Team[]> {
    return await this.repository.listTeams(repositoryId);
  }

  async listAvailableUsers(repositoryId: number): Promise<TeamAvailableUser[]> {
    return await this.repository.listAvailableUsers(repositoryId);
  }

  async listMemberLoginsByTeamSlugs(
    repositoryId: number,
    teamSlugs: string[],
  ): Promise<string[]> {
    return await this.repository.listMemberLoginsByTeamSlugs(
      repositoryId,
      teamSlugs,
    );
  }

  async getTeamMembers(
    repositoryId: number,
    teamId: number,
  ): Promise<TeamMember[]> {
    await this.getTeamOrThrow(repositoryId, teamId);
    return await this.repository.getTeamMembers(repositoryId, teamId);
  }

  async createManualTeam(
    repositoryId: number,
    input: CreateTeamRequest,
  ): Promise<Team> {
    const userIds = uniquePositiveInts(input.userIds);
    await this.assertKnownUsers(userIds);
    return await this.repository.createManualTeam(
      repositoryId,
      input.name,
      userIds,
    );
  }

  async updateManualTeam(
    repositoryId: number,
    teamId: number,
    input: UpdateTeamRequest,
  ): Promise<Team> {
    const team = await this.getTeamOrThrow(repositoryId, teamId);
    this.assertManualTeam(team);
    return await this.repository.updateTeam(repositoryId, teamId, input.name);
  }

  async replaceManualTeamMembers(
    repositoryId: number,
    teamId: number,
    userIds: number[],
  ): Promise<TeamMember[]> {
    const team = await this.getTeamOrThrow(repositoryId, teamId);
    this.assertManualTeam(team);

    const dedupedUserIds = uniquePositiveInts(userIds);
    await this.assertKnownUsers(dedupedUserIds);

    return await this.repository.replaceTeamMembers(
      repositoryId,
      teamId,
      dedupedUserIds,
    );
  }

  private async getTeamOrThrow(
    repositoryId: number,
    teamId: number,
  ): Promise<Team> {
    const team = await this.repository.getTeamById(repositoryId, teamId);
    if (!team) {
      throw new TeamNotFoundError(repositoryId, teamId);
    }
    return team;
  }

  private assertManualTeam(team: Team): void {
    if (team.sourceType !== "manual") {
      throw new TeamReadOnlyError();
    }
  }

  private async assertKnownUsers(userIds: number[]): Promise<void> {
    if (userIds.length === 0) {
      return;
    }

    const existingUserIds = await this.repository.getExistingUserIds(userIds);
    const missingUserIds = userIds.filter(
      (userId) => !existingUserIds.has(userId),
    );
    if (missingUserIds.length > 0) {
      throw new UnknownUserIdsError(missingUserIds);
    }
  }
}

function uniquePositiveInts(values: number[]): number[] {
  return Array.from(new Set(values)).filter((value) => value > 0);
}
