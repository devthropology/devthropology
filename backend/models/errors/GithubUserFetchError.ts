export class GithubUserFetchError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "GithubUserFetchError";
    this.status = status;
  }
}
