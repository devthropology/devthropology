import { Buffer } from "node:buffer";
import { z } from "zod";
import { InvalidPullError } from "../models/errors/InvalidPullError.ts";
import { RateExceededError } from "../models/errors/RateExceededError.ts";
import { GithubUserFetchError } from "../models/errors/GithubUserFetchError.ts";
import { PullRequest, PullRequestSchema } from "../models/gh/pullRequest.ts";
import {
  Commit,
  NullableCommit,
  NullableCommitSchema,
} from "../models/gh/commit.ts";
import { RateLimit, RateLimitSchema } from "../models/gh/rateLimit.ts";
import { Review, ReviewSchema } from "../models/gh/review.ts";
import {
  Comment,
  GhCommentSchema,
  GhIssueCommentSchema,
  IssueComment,
} from "../models/gh/comment.ts";
import { PullRequestNumberSchema } from "../models/gh/pullRequestNumber.ts";
import { State } from "../models/gh/state.ts";
import {
  PullRequestSearch,
  PullRequestSearchSchema,
} from "../models/gh/pullRequestSearch.ts";
import { File, FileSchema } from "../models/gh/file.ts";
import {
  BasicIssue,
  BasicIssueSchema,
  HydratedIssue,
} from "../models/gh/issue.ts";
import { NotFound } from "../models/errors/notFound.ts";
import { IssueType } from "../models/gh/issueType.ts";
import { HydratedPullRequest } from "../models/gh/hydratedPullRequest.ts";
import { JsonValue } from "../test/mock_fetch.ts";
import { IssueMoved } from "../models/errors/IssueMoved.ts";
import { IssueDeleted } from "../models/errors/IssueDeleted.ts";
import {
  GhUserProfile,
  GhUserProfileSchema,
} from "../models/gh/userProfile.ts";
import { GhTeam, GhTeamSchema } from "../models/gh/team.ts";
import { User, UserSchema } from "../models/gh/user.ts";
import {
  GithubResponseParseError,
  GithubResponseShapeError,
  GithubResponseStatusError,
} from "../models/errors/githubResponseErrors.ts";

import type { GithubCredentialsProvider } from "../models/githubCredentials.ts";

interface EndpointResponse {
  endpoint: string;
  response: JsonValue;
  status: number;
}

export class GhApi {
  baseUrl = "https://api.github.com";
  owner: string;
  repo: string;
  username: string;
  token: string | undefined;
  issueResponseData: Record<number, EndpointResponse[]>;

  constructor(
    owner: string,
    repo: string,
    username: string,
    token: string | undefined,
    private readonly credentials?: GithubCredentialsProvider,
  ) {
    this.owner = owner;
    this.repo = repo;
    this.username = username;
    this.token = token;
    this.issueResponseData = {};
  }

  async getFullIssue(number: number): Promise<HydratedIssue> {
    this.issueResponseData = {};
    this.issueResponseData[number] = this.issueResponseData[number] || [];

    const issue = await this.getIssue(number);

    const type: IssueType = issue.pull_request
      ? IssueType.PULL_REQUEST
      : IssueType.ISSUE;

    if (type == IssueType.ISSUE || issue.state == State.OPEN) {
      return {
        ...issue,
        hydrated_pull_request: undefined,
        type,
      };
    }

    const pullRequest = await this.getPullRequest(number);
    let prComments: Comment[] = [];
    let issueComments: IssueComment[] = [];
    let ghCommits: NullableCommit[] = [];
    let reviews: Review[] = [];
    let files: File[] = [];

    const promises = [];
    promises.push(
      this.getPullRequestCommits(number).then((data) => (ghCommits = data)),
    );
    promises.push(
      this.getPullRequestFiles(number).then((data) => (files = data)),
    );
    promises.push(
      this.getPullRequestReviews(number).then((data) => (reviews = data)),
    );

    if (pullRequest.comments !== 0) {
      promises.push(
        this.getIssueComments(number).then((data) => (issueComments = data)),
      );
    }
    if (pullRequest.review_comments !== 0) {
      promises.push(
        this.getPullRequestComments(number).then((data) => (prComments = data)),
      );
    }
    await Promise.all(promises);

    let foundCommitWithNoAuthor = false;
    const commitsWithAuthor: Commit[] = ghCommits.map((ghCommit): Commit => {
      let author = ghCommit.user;
      // In the event that a commit has no User (person must not have their .gitconfig set up properly), we assign the author of the PR to the commit
      if (ghCommit.user === null || ghCommit.user === undefined) {
        foundCommitWithNoAuthor = true;
        author = pullRequest.user;
      }
      // Year of github founding; could also check for 1970 but could be error prone due to offsets; could also do less than 1971
      if (ghCommit.commitTime < new Date("2008-01-01T00:00:00Z")) {
        console.log(
          `Found commit with ancient date for PR ${number} - with ancient date ${ghCommit.commitTime} setting it issue creation ${issue.created_at}`,
        );
        ghCommit.commitTime = issue.created_at;
      }
      return {
        // TODO: should this be written in a way for typescript to know that author is not nullable?
        ...ghCommit,
        user: author!,
      };
    });
    // This exists here to only log once per PR
    if (foundCommitWithNoAuthor) {
      console.log(
        `Found commit with no author for PR ${number} - assigning to ${pullRequest.user.login}`,
      );
    }

    // TODO: come back and fix this, perhaps making HydratedPullRequest a proper interface and having this class just return the objects from the API
    const hydratedPullRequest: HydratedPullRequest = {
      sourceBranch: pullRequest.head.ref,
      targetBranch: pullRequest.base.ref,
      ...pullRequest,
      commentList: prComments,
      commitList: commitsWithAuthor,
      reviews: reviews,
      files: files,
      issueCommentList: issueComments,
    };
    return {
      ...issue,
      hydrated_pull_request: hydratedPullRequest,
      type: IssueType.PULL_REQUEST,
    };
  }

  async getMostRecentIssue(): Promise<number> {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/issues?per_page=1&page=1&direction=desc&state=all`;
    const response = await this.request(url);
    const jsonArray = await response.json();
    return PullRequestNumberSchema.parse(jsonArray[0]).number;
  }

  async getUserProfile(username: string): Promise<GhUserProfile> {
    const url = `${this.baseUrl}/users/${username}`;
    const response = await this.request(url);

    if (response.status === 403) {
      const resetTime = response.headers.get("x-ratelimit-reset") ?? "";
      throw new RateExceededError(resetTime);
    }

    if (!response.ok) {
      throw new GithubUserFetchError(
        response.status,
        `GitHub user request failed with status ${response.status}`,
      );
    }

    const json = await response.json();
    return GhUserProfileSchema.parse(json);
  }

  async getOrgTeams(org: string): Promise<GhTeam[]> {
    return await this.fetchCollection(
      `${this.baseUrl}/orgs/${org}/teams`,
      GhTeamSchema,
    );
  }

  async getTeamMembers(org: string, teamSlug: string): Promise<User[]> {
    return await this.fetchCollection(
      `${this.baseUrl}/orgs/${org}/teams/${teamSlug}/members`,
      UserSchema,
    );
  }

  async teamHasRepositoryAccess(
    org: string,
    teamSlug: string,
    owner: string,
    repo: string,
  ): Promise<boolean> {
    const url = `${this.baseUrl}/orgs/${org}/teams/${teamSlug}/repos/${owner}/${repo}`;
    const response = await this.request(url);

    if (response.status === 404) {
      return false;
    }
    if (response.status === 403) {
      const resetTime = response.headers.get("x-ratelimit-reset") ?? "";
      throw new RateExceededError(resetTime);
    }
    if (!response.ok && response.status !== 204) {
      const body = await response.text();
      throw new Error(
        `GitHub team repository check failed with status ${response.status}: ${body}`,
      );
    }

    return true;
  }

  async getIssue(number: number): Promise<BasicIssue> {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/issues/${number}`;
    const response = await this.request(url, { redirect: "manual" });

    if (response.status == 301) {
      throw new IssueMoved(number);
    }
    if (response.status === 404) {
      throw new NotFound(number, url);
    }
    if (response.status === 403) {
      const resetTime = response.headers.get("x-ratelimit-reset") ?? "";
      throw new RateExceededError(resetTime);
    }
    if (response.status === 410) {
      throw new IssueDeleted(number);
    }

    const json = await response.json();
    this._recordEndpointResponse(number, url, json, response.status);
    return this.parseGitHubResponse(BasicIssueSchema, json, {
      schemaName: "BasicIssueSchema",
      url,
      status: response.status,
    });
  }

  private async getPullRequest(number: number): Promise<PullRequest> {
    const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/pulls/${number}`;
    const response = await this.request(url);
    if (response.status === 404) {
      throw new InvalidPullError(number);
    }
    if (response.status === 403) {
      const resetTime = response.headers.get("x-ratelimit-reset") ?? "";
      throw new RateExceededError(resetTime);
    }
    const json = await response.json();
    this._recordEndpointResponse(number, url, json, response.status);
    return this.parseGitHubResponse(PullRequestSchema, json, {
      schemaName: "PullRequestSchema",
      url,
      status: response.status,
    });
  }

  private async getPullRequestComments(number: number): Promise<Comment[]> {
    return await this.fetchAndParse("comments", GhCommentSchema, number);
  }

  private async getIssueComments(number: number): Promise<IssueComment[]> {
    return await this.fetchAndParse(
      "comments",
      GhIssueCommentSchema,
      number,
      "issues",
    );
  }

  private async getPullRequestCommits(
    number: number,
  ): Promise<NullableCommit[]> {
    return await this.fetchAndParse("commits", NullableCommitSchema, number);
  }

  private async getPullRequestReviews(number: number): Promise<Review[]> {
    return await this.fetchAndParse("reviews", ReviewSchema, number);
  }

  private async getPullRequestFiles(number: number): Promise<File[]> {
    return await this.fetchAndParse("files", FileSchema, number);
  }

  async getPullRequestFilesById(number: number): Promise<File[]> {
    return await this.fetchAndParse("files", FileSchema, number);
  }

  private async fetchAndParse<T extends z.ZodTypeAny>(
    endpoint: string,
    schema: T,
    number: number,
    resource: "pulls" | "issues" = "pulls",
  ): Promise<z.output<T>[]> {
    const perPage = 100;
    let page = 1;
    const items: z.output<T>[] = [];

    while (true) {
      const url = `${this.baseUrl}/repos/${this.owner}/${this.repo}/${resource}/${number}/${endpoint}?per_page=${perPage}&page=${page}`;
      const response = await this.request(url);

      if (response.status === 403) {
        const resetTime = response.headers.get("x-ratelimit-reset") ?? "";
        throw new RateExceededError(resetTime);
      }

      if (!response.ok) {
        const payload = await this.readResponsePayload(response);
        this._recordEndpointResponse(number, url, payload, response.status);
        throw new GithubResponseStatusError(url, response.status, payload);
      }

      const jsonValue = await response.json();

      if (!Array.isArray(jsonValue)) {
        this._recordEndpointResponse(
          number,
          url,
          jsonValue as JsonValue,
          response.status,
        );
        throw new GithubResponseShapeError(
          "array",
          url,
          response.status,
          jsonValue as JsonValue,
        );
      }

      this._recordEndpointResponse(
        number,
        url,
        jsonValue as JsonValue,
        response.status,
      );

      if (jsonValue.length === 0) {
        break;
      }
      items.push(
        ...jsonValue.map((payload, index) =>
          this.parseGitHubResponse(schema, payload, {
            schemaName: `${resource}/${endpoint} item schema`,
            url: `${url}#item-${index}`,
            status: response.status,
          }),
        ),
      );
      if (jsonValue.length < perPage) {
        break;
      }
      page++;
    }

    return items;
  }

  private async fetchCollection<T extends z.ZodTypeAny>(
    baseUrl: string,
    schema: T,
  ): Promise<z.output<T>[]> {
    const perPage = 100;
    let page = 1;
    const items: z.output<T>[] = [];

    while (true) {
      const separator = baseUrl.includes("?") ? "&" : "?";
      const url = `${baseUrl}${separator}per_page=${perPage}&page=${page}`;
      const response = await this.request(url);

      if (response.status === 403) {
        const resetTime = response.headers.get("x-ratelimit-reset") ?? "";
        throw new RateExceededError(resetTime);
      }
      if (!response.ok) {
        const payload = await this.readResponsePayload(response);
        throw new GithubResponseStatusError(url, response.status, payload);
      }

      const jsonValue = await response.json();
      if (!Array.isArray(jsonValue)) {
        // Collection requests are not issue-scoped, so endpoint response recording is intentionally omitted here.
        throw new GithubResponseShapeError(
          "array",
          url,
          response.status,
          jsonValue as JsonValue,
        );
      }

      if (jsonValue.length === 0) {
        break;
      }

      items.push(
        ...jsonValue.map((payload, index) =>
          this.parseGitHubResponse(schema, payload, {
            schemaName: "collection item schema",
            url: `${url}#item-${index}`,
            status: response.status,
          }),
        ),
      );
      if (jsonValue.length < perPage) {
        break;
      }

      page++;
    }

    return items;
  }

  async getPullRequestNumbersByUser(author: string): Promise<number[]> {
    const perPage = 100;
    let oldestSeenPr = new Date();
    const searchResults: PullRequestSearch[] = [];
    while (true) {
      const encodedQuery = encodeURI(
        `author:${author} repo:${this.owner}/${this.repo} created:<${oldestSeenPr.toISOString()}`,
      );
      const url = `${this.baseUrl}/search/issues?q=${encodedQuery}&per_page=${perPage}`;

      const response = await this.request(url);
      if (response.status != 200) {
        const body = await response.text();
        throw new Error(response.status + " with message " + body);
      }

      const json = await response.json();
      const schema = PullRequestSearchSchema.parse(json);
      searchResults.push(schema);
      if (schema.items.length < perPage) {
        break;
      }

      oldestSeenPr = schema.items.reduce((oldest, item) => {
        return new Date(item.created_at) < new Date(oldest.created_at)
          ? item
          : oldest;
      }).created_at;
    }
    return searchResults.flatMap((result) =>
      result.items.map((item) => item.number),
    );
  }

  async getRateLimit(): Promise<RateLimit> {
    const url = `${this.baseUrl}/rate_limit`;
    const response = await this.request(url);
    const json = await response.json();
    return RateLimitSchema.parse(json);
  }
  private async request(
    url: string,
    options: RequestInit = {},
  ): Promise<Response> {
    const headers = new Headers(this.getHeaders().headers);
    if (this.credentials) {
      // An injected provider replaces legacy credentials, never falls back to them.
      headers.delete("Authorization");
      const authorization = await this.credentials.getAuthorizationHeader();
      if (!authorization?.trim()) {
        throw new Error(
          "GitHub credential provider returned no authorization.",
        );
      }
      headers.set("Authorization", authorization);
    }
    return await fetch(url, { ...options, headers });
  }

  /** Legacy static headers only. Use API methods for provider-backed requests. */
  getHeaders(): RequestInit {
    if (!this.username || !this.token) {
      return {
        headers: {
          Accept: "application/vnd.github+json",
        },
      };
    }
    return {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization:
          "Basic " +
          Buffer.from(`${this.username}:${this.token}`, "utf8").toString(
            "base64",
          ),
      },
    };
  }

  private _recordEndpointResponse(
    number: number,
    endpoint: string,
    response: JsonValue,
    status: number,
  ) {
    this.issueResponseData[number] = this.issueResponseData[number] || [];
    this.issueResponseData[number].push({
      endpoint,
      response,
      status,
    });
  }

  private parseGitHubResponse<T extends z.ZodTypeAny>(
    schema: T,
    payload: JsonValue,
    context: { schemaName: string; url: string; status: number },
  ): z.output<T> {
    const parsed = schema.safeParse(payload);
    if (parsed.success) {
      return parsed.data;
    }
    throw new GithubResponseParseError(
      context.schemaName,
      context.url,
      context.status,
      payload,
      parsed.error,
    );
  }

  private async readResponsePayload(response: Response): Promise<JsonValue> {
    const body = await response.text();
    try {
      return JSON.parse(body) as JsonValue;
    } catch {
      return body;
    }
  }

  getEndpointResponses(): Record<number, EndpointResponse[]> {
    return this.issueResponseData;
  }
}
