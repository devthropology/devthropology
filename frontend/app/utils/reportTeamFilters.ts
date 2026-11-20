import { API_URL, authenticatedFetch } from "~/config";
import type { Team, TeamMember } from "../../../shared/models/team";

export function parseCommaSeparatedParam(value: string | null): string[] {
  if (!value) {
    return [];
  }

  return Array.from(
    new Set(
      value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  );
}

export async function loadReportTeamFilterData(
  request: Request,
  userToken: string,
  repositoryId: string,
  selectedTeamSlugs: string[],
): Promise<{ teams: Team[]; selectedTeamMembers: string[] }> {
  try {
    const teamsResponse = await authenticatedFetch(
      `${API_URL}/api/repository/${repositoryId}/teams`,
      userToken,
      { request, retryCount: 1 },
    );

    if (!teamsResponse.ok) {
      return { teams: [], selectedTeamMembers: [] };
    }

    const teams: Team[] = await teamsResponse.json();
    const selectedTeams = teams.filter((team) => selectedTeamSlugs.includes(team.slug));

    if (selectedTeams.length === 0) {
      return { teams, selectedTeamMembers: [] };
    }

    const memberResponses = await Promise.all(
      selectedTeams.map(async (team) => {
        try {
          const response = await authenticatedFetch(
            `${API_URL}/api/repository/${repositoryId}/teams/${team.teamId}/members`,
            userToken,
            { request, retryCount: 1 },
          );
          if (!response.ok) {
            return [] as TeamMember[];
          }
          return (await response.json()) as TeamMember[];
        } catch {
          return [] as TeamMember[];
        }
      }),
    );

    const selectedTeamMembers = Array.from(
      new Set(
        memberResponses
          .flat()
          .map((member) => member.ghLogin)
          .filter(Boolean),
      ),
    ).sort((left, right) => left.localeCompare(right));

    return { teams, selectedTeamMembers };
  } catch {
    return { teams: [], selectedTeamMembers: [] };
  }
}
