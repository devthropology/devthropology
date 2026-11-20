/** Resolved for each request so short-lived credentials can renew during a sync. */
export interface GithubCredentialsProvider {
  getAuthorizationHeader(): Promise<string>;
}
