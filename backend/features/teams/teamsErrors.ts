export class TeamNotFoundError extends Error {
  constructor(repositoryId: number, teamId: number) {
    super(`Team ${teamId} not found for repository ${repositoryId}`);
    this.name = "TeamNotFoundError";
  }
}

export class TeamReadOnlyError extends Error {
  constructor() {
    super("GitHub-backed teams are read-only");
    this.name = "TeamReadOnlyError";
  }
}

export class UnknownUserIdsError extends Error {
  readonly userIds: number[];

  constructor(userIds: number[]) {
    super(`Unknown user ids: ${userIds.join(", ")}`);
    this.name = "UnknownUserIdsError";
    this.userIds = userIds;
  }
}
