export class InvalidPullError extends Error {
  constructor(pullRequest: number) {
    super("Pull request " + pullRequest + " not found");
  }
}
