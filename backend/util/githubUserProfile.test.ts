import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { describe, it } from "vitest";
import {
  githubUserProfilesDiffer,
  normalizeGithubTimestamp,
  toGithubUser,
  toGithubUserProfileSnapshot,
} from "./githubUserProfile.ts";

describe("githubUserProfile helpers", () => {
  it("normalizes nullable GitHub fields", () => {
    const githubUser = toGithubUser({
      login: "octo-example",
      name: "Alex Sample",
      avatar_url: "https://example.com/avatars/octo-example.png",
      company: "Example Co",
      location: "Example City",
      created_at: "2013-02-01T01:25:13Z",
      bio: null,
      blog: "",
      email: undefined,
      twitter_username: null,
      html_url: "https://example.com/octo-example",
    });

    assertEquals(githubUser.email, null);

    const snapshot = toGithubUserProfileSnapshot({
      login: "octo-example",
      name: "Alex Sample",
      avatar_url: "https://example.com/avatars/octo-example.png",
      company: "Example Co",
      location: "Example City",
      created_at: "2013-02-01T01:25:13Z",
      bio: null,
      blog: "",
      email: undefined,
      twitter_username: null,
      html_url: "https://example.com/octo-example",
    });

    assertEquals(snapshot.email, null);
    assertEquals(snapshot.github_created_at, "2013-02-01T01:25:13.000Z");
    assertEquals(githubUser.created_at, "2013-02-01T01:25:13.000Z");
  });

  it("drops invalid public profile email values", () => {
    const githubUser = toGithubUser({
      login: "octo-jamie",
      name: "Jamie Sample",
      avatar_url: "https://example.com/avatars/octo-jamie.png",
      company: null,
      location: "Example City",
      created_at: "2009-10-09T09:05:49Z",
      bio: null,
      blog: "",
      email: "https://example.com/contact",
      twitter_username: null,
      html_url: "https://example.com/octo-jamie",
    });

    const snapshot = toGithubUserProfileSnapshot({
      login: "octo-taylor",
      name: "Taylor Sample",
      avatar_url: "https://example.com/avatars/octo-taylor.png",
      company: null,
      location: "Example City",
      created_at: "2011-06-08T14:38:57Z",
      bio: null,
      blog: "https://example.com/blog",
      email: "@octo-taylor",
      twitter_username: null,
      html_url: "https://example.com/octo-taylor",
    });

    assertEquals(githubUser.email, null);
    assertEquals(snapshot.email, null);
  });

  it("preserves valid email values", () => {
    const githubUser = toGithubUser({
      login: "octo-example",
      name: "Alex Sample",
      avatar_url: "https://example.com/avatars/octo-example.png",
      company: null,
      location: null,
      created_at: "2013-02-01T01:25:13Z",
      bio: null,
      blog: "",
      email: "alex@example.com",
      twitter_username: null,
      html_url: "https://example.com/octo-example",
    });

    const snapshot = toGithubUserProfileSnapshot({
      login: "octo-example",
      name: "Alex Sample",
      avatar_url: "https://example.com/avatars/octo-example.png",
      company: null,
      location: null,
      created_at: "2013-02-01T01:25:13Z",
      bio: null,
      blog: "",
      email: "alex@example.com",
      twitter_username: null,
      html_url: "https://example.com/octo-example",
    });

    assertEquals(githubUser.email, "alex@example.com");
    assertEquals(snapshot.email, "alex@example.com");
  });

  it("detects profile changes only when tracked fields differ", () => {
    const current = {
      avatar_url: "https://example.com/avatars/octo-example.png",
      name: "Alex Sample",
      company: "Example Co",
      location: "Example City",
      email: null,
      github_created_at: "2013-02-01T01:25:13Z",
    };

    assertEquals(githubUserProfilesDiffer(current, { ...current }), false);
    assertEquals(
      githubUserProfilesDiffer(current, { ...current, name: "Alex Example" }),
      true,
    );
    assertEquals(
      githubUserProfilesDiffer(current, {
        ...current,
        email: "alex@example.com",
      }),
      true,
    );
    assertEquals(
      normalizeGithubTimestamp("2013-02-01T01:25:13Z"),
      "2013-02-01T01:25:13.000Z",
    );
  });
});
