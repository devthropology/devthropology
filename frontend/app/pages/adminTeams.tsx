import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLoaderData } from "react-router";
import { Users } from "lucide-react";

type TeamSourceType = "manual" | "github";
type TeamSourceFilter = "all" | TeamSourceType;
type MemberVisibilityFilter = "all" | "selected" | "unselected";

type Team = {
  teamId: number;
  repositoryId: number;
  name: string;
  slug: string;
  sourceType: TeamSourceType;
  ghTeamId: number | null;
  ghOrgLogin: string | null;
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

type TeamMember = {
  teamMemberId: number;
  teamId: number;
  userId: number;
  ghLogin: string;
  memberRole: "member" | "maintainer" | null;
  sourceType: TeamSourceType;
  createdAt: string;
  updatedAt: string;
};

type AvailableUser = {
  userId: number;
  ghLogin: string;
};

type ErrorPayload = {
  error?: string;
};

export type AdminTeamsLoaderData = {
  repositoryId: string | null;
  userToken: string;
};

export async function loadTeamsPageData(
  _request: Request,
  userToken: string,
  repositoryId: string | null,
): Promise<AdminTeamsLoaderData> {
  return { repositoryId, userToken };
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  const payload = (await response.json().catch(() => null)) as ErrorPayload | null;
  return payload?.error ?? fallback;
}

export default function AdminTeamsPage() {
  const { repositoryId } = useLoaderData<AdminTeamsLoaderData>();
  const [teams, setTeams] = useState<Team[]>([]);
  const [availableUsers, setAvailableUsers] = useState<AvailableUser[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState<number | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingName, setIsSavingName] = useState(false);
  const [isSavingMembers, setIsSavingMembers] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createName, setCreateName] = useState("");
  const [editName, setEditName] = useState("");
  const [memberFilter, setMemberFilter] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<TeamSourceFilter>("all");
  const [memberVisibilityFilter, setMemberVisibilityFilter] =
    useState<MemberVisibilityFilter>("all");

  const selectedTeam = teams.find((team) => team.teamId === selectedTeamId) ?? null;
  const teamsApiPath = repositoryId ? `/app/api/repository/${repositoryId}/teams` : null;

  const filteredUsers = useMemo(() => {
    const normalized = memberFilter.trim().toLowerCase();
    if (!normalized) {
      return availableUsers;
    }

    return availableUsers.filter((user) => user.ghLogin.toLowerCase().includes(normalized));
  }, [availableUsers, memberFilter]);

  const visibleTeams = useMemo(() => {
    if (sourceFilter === "all") {
      return teams;
    }

    return teams.filter((team) => team.sourceType === sourceFilter);
  }, [teams, sourceFilter]);

  const visibleAvailableUsers = useMemo(() => {
    if (memberVisibilityFilter === "selected") {
      return filteredUsers.filter((user) => selectedUserIds.includes(user.userId));
    }

    if (memberVisibilityFilter === "unselected") {
      return filteredUsers.filter((user) => !selectedUserIds.includes(user.userId));
    }

    return filteredUsers;
  }, [filteredUsers, memberVisibilityFilter, selectedUserIds]);

  const loadTeams = async () => {
    if (!repositoryId) {
      return;
    }

    const response = await fetch(teamsApiPath!, {
      credentials: "same-origin",
    });

    if (!response.ok) {
      throw new Error("Failed to fetch teams");
    }

    const data = await readJson<Team[]>(response);
    setTeams(data);
    setSelectedTeamId((current) => current ?? data[0]?.teamId ?? null);
  };

  const loadAvailableUsers = async () => {
    if (!repositoryId) {
      return;
    }

    const proxiedResponse = await fetch(
      `/app/api/repository/${repositoryId}/teams?view=available-users`,
      { credentials: "same-origin" },
    );

    if (!proxiedResponse.ok) {
      throw new Error("Failed to fetch available users");
    }

    setAvailableUsers(await readJson<AvailableUser[]>(proxiedResponse));
  };

  const loadTeamMembers = async (teamId: number) => {
    if (!repositoryId) {
      return;
    }

    const response = await fetch(
      `/app/api/repository/${repositoryId}/teams/${teamId}?view=members`,
      {
        credentials: "same-origin",
      },
    );

    if (!response.ok) {
      throw new Error("Failed to fetch team members");
    }

    const data = await readJson<TeamMember[]>(response);
    setTeamMembers(data);
    setSelectedUserIds(data.map((member: TeamMember) => member.userId));
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!repositoryId) {
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        await Promise.all([loadTeams(), loadAvailableUsers()]);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load teams");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [repositoryId]);

  useEffect(() => {
    if (selectedTeamId === null) {
      return;
    }

    const selectedStillVisible = visibleTeams.some((team) => team.teamId === selectedTeamId);
    if (!selectedStillVisible) {
      setSelectedTeamId(visibleTeams[0]?.teamId ?? null);
    }
  }, [visibleTeams, selectedTeamId]);

  useEffect(() => {
    if (!selectedTeam) {
      setTeamMembers([]);
      setSelectedUserIds([]);
      setEditName("");
      return;
    }

    setEditName(selectedTeam.name);
    void loadTeamMembers(selectedTeam.teamId).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load team members");
    });
  }, [selectedTeamId]);

  const handleCreateTeam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!repositoryId || !createName.trim()) {
      return;
    }

    setIsCreating(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(`/app/api/repository/${repositoryId}/teams`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: createName.trim(), userIds: [] }),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to create team"));
      }

      const created = await readJson<Team>(response);
      setCreateName("");
      setMessage(`Created ${created.name}`);
      await loadTeams();
      setSelectedTeamId(created.teamId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create team");
    } finally {
      setIsCreating(false);
    }
  };

  const handleRenameTeam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!repositoryId || !selectedTeam || selectedTeam.sourceType !== "manual") {
      return;
    }

    setIsSavingName(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/app/api/repository/${repositoryId}/teams/${selectedTeam.teamId}`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ name: editName.trim() }),
        },
      );

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to update team"));
      }

      setMessage("Team updated");
      await loadTeams();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update team");
    } finally {
      setIsSavingName(false);
    }
  };

  const handleSaveMembers = async () => {
    if (!repositoryId || !selectedTeam || selectedTeam.sourceType !== "manual") {
      return;
    }

    setIsSavingMembers(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch(
        `/app/api/repository/${repositoryId}/teams/${selectedTeam.teamId}?view=members`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ userIds: selectedUserIds }),
        },
      );

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, "Failed to update team members"));
      }

      const members = await readJson<TeamMember[]>(response);
      setTeamMembers(members);
      setMessage("Team members updated");
      await loadTeams();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update team members");
    } finally {
      setIsSavingMembers(false);
    }
  };

  const toggleUser = (userId: number) => {
    setSelectedUserIds((current) =>
      current.includes(userId) ? current.filter((value) => value !== userId) : [...current, userId],
    );
  };

  return (
    <div className="space-y-6 pb-6 text-white">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Teams</h1>
          <p className="mt-1 text-sm text-gray-400">
            Create manual teams for this repository and view synced GitHub teams.
          </p>
        </div>
      </div>

      {(message || error) && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            error
              ? "border-red-800 bg-red-950/40 text-red-200"
              : "border-green-800 bg-green-950/40 text-green-200"
          }`}
        >
          {error ?? message}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-6">
          <section className="rounded-lg bg-white/5 p-6">
            <h2 className="text-xl font-semibold">Create Team</h2>
            <form className="mt-4 space-y-4" onSubmit={handleCreateTeam}>
              <div>
                <label className="mb-2 block text-sm font-medium text-gray-300">Team name</label>
                <input
                  type="text"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  placeholder="e.g. Platform"
                />
              </div>
              <button
                type="submit"
                disabled={isCreating || !createName.trim()}
                className="inline-flex w-full items-center justify-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700"
              >
                {isCreating ? "Creating..." : "Create team"}
              </button>
            </form>
          </section>

          <section className="rounded-lg bg-white/5 p-6">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold">Teams</h2>
              <button
                type="button"
                onClick={() => void loadTeams().catch((err) => setError(String(err)))}
                className="text-sm text-blue-400 hover:text-blue-300"
              >
                Refresh
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              {(
                [
                  { label: "All", value: "all" },
                  { label: "Manual", value: "manual" },
                  { label: "GitHub", value: "github" },
                ] as const
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSourceFilter(option.value)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                    sourceFilter === option.value
                      ? "bg-blue-600 text-white"
                      : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="mt-4 space-y-2">
              {isLoading ? (
                <div className="rounded-md border border-gray-800 bg-gray-900/60 px-3 py-4 text-sm text-gray-400">
                  Loading teams...
                </div>
              ) : visibleTeams.length === 0 ? (
                <div className="rounded-md border border-gray-800 bg-gray-900/60 px-3 py-4 text-sm text-gray-400">
                  No teams match this filter.
                </div>
              ) : (
                visibleTeams.map((team) => (
                  <button
                    key={team.teamId}
                    type="button"
                    onClick={() => setSelectedTeamId(team.teamId)}
                    className={`w-full rounded-md border px-4 py-3 text-left transition ${
                      selectedTeamId === team.teamId
                        ? "border-blue-500 bg-blue-500/10"
                        : "border-gray-800 bg-gray-900/60 hover:border-gray-700"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">{team.name}</div>
                        <div className="mt-1 text-xs text-gray-400">{team.memberCount} members</div>
                      </div>
                      <span
                        className={`rounded-full px-2 py-1 text-xs font-medium ${
                          team.sourceType === "manual"
                            ? "bg-blue-950/70 text-blue-200"
                            : "bg-gray-800 text-gray-200"
                        }`}
                      >
                        {team.sourceType === "manual" ? "Manual" : "GitHub"}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </section>
        </div>

        <section className="rounded-lg bg-white/5 p-6">
          {!selectedTeam ? (
            <div className="flex h-full min-h-[420px] items-center justify-center rounded-lg border border-dashed border-gray-700 bg-gray-900/40 text-sm text-gray-400">
              Select a team to edit members and details.
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex flex-col gap-3 border-b border-gray-800 pb-5 md:flex-row md:items-start md:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <Users className="h-5 w-5 text-gray-300" />
                    <h2 className="text-xl font-semibold">{selectedTeam.name}</h2>
                  </div>
                  <p className="mt-2 text-sm text-gray-400">
                    {selectedTeam.sourceType === "manual"
                      ? "Manual teams can be renamed and edited here."
                      : "GitHub-backed teams are read-only here and refresh from sync."}
                  </p>
                </div>
                <div className="rounded-md border border-gray-800 bg-gray-900/60 px-3 py-2 text-xs text-gray-300">
                  slug: {selectedTeam.slug}
                </div>
              </div>

              <form className="space-y-4" onSubmit={handleRenameTeam}>
                <div>
                  <label className="mb-2 block text-sm font-medium text-gray-300">Team name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(event) => setEditName(event.target.value)}
                    disabled={selectedTeam.sourceType !== "manual"}
                    className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:cursor-not-allowed disabled:bg-gray-900"
                  />
                </div>
                <button
                  type="submit"
                  disabled={
                    isSavingName || selectedTeam.sourceType !== "manual" || !editName.trim()
                  }
                  className="inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700"
                >
                  {isSavingName ? "Saving..." : "Save name"}
                </button>
              </form>

              <div className="space-y-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold">Members</h3>
                    <p className="mt-1 text-sm text-gray-400">
                      {selectedTeam.sourceType === "manual"
                        ? "Filter users and replace the full member list."
                        : "Current members from GitHub sync."}
                    </p>
                  </div>
                  {selectedTeam.sourceType === "manual" && (
                    <button
                      type="button"
                      onClick={handleSaveMembers}
                      disabled={isSavingMembers}
                      className="inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700"
                    >
                      {isSavingMembers ? "Saving..." : "Save members"}
                    </button>
                  )}
                </div>

                {selectedTeam.sourceType === "manual" && (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={memberFilter}
                      onChange={(event) => setMemberFilter(event.target.value)}
                      className="w-full rounded-md border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                      placeholder="Filter users by GitHub login"
                    />
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { label: "All users", value: "all" },
                          { label: "Selected", value: "selected" },
                          { label: "Unselected", value: "unselected" },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => setMemberVisibilityFilter(option.value)}
                          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                            memberVisibilityFilter === option.value
                              ? "bg-blue-600 text-white"
                              : "bg-gray-800 text-gray-300 hover:bg-gray-700"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {selectedTeam.sourceType === "manual"
                    ? visibleAvailableUsers.map((user) => {
                        const checked = selectedUserIds.includes(user.userId);
                        return (
                          <label
                            key={user.userId}
                            className="flex items-center gap-3 rounded-md border border-gray-800 bg-gray-900/60 px-3 py-3 text-sm"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleUser(user.userId)}
                              className="h-4 w-4 rounded border-gray-600 bg-gray-800 text-blue-500"
                            />
                            <span className="min-w-0 truncate text-white">{user.ghLogin}</span>
                          </label>
                        );
                      })
                    : teamMembers.map((member) => (
                        <div
                          key={member.teamMemberId}
                          className="flex items-center gap-3 rounded-md border border-gray-800 bg-gray-900/60 px-3 py-3 text-sm"
                        >
                          <span className="inline-flex h-4 w-4 rounded-full bg-gray-700" />
                          <span className="min-w-0 truncate text-white">{member.ghLogin}</span>
                        </div>
                      ))}
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
