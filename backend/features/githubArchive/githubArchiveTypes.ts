export interface GithubArchiveSnapshot {
  number: number;
  type: "pull_request" | "issue";
  fetchedAt: string;
  responses: Array<{
    endpoint: string;
    status: number;
    response: unknown;
  }>;
}

export interface GithubArchive {
  uploadPending(): Promise<number>;
  save(snapshot: GithubArchiveSnapshot): Promise<void>;
}

// Archive failures must not be swallowed by the legacy backfill loop.
export class GithubArchiveError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "GithubArchiveError";
  }
}
