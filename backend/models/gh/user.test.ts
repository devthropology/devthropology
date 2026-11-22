import { expect, test } from "vitest";
import { GHOST_USER, UNKNOWN_USER, UserSchema, isGithubBot } from "./user.ts";
import { GhIssueCommentSchema } from "./comment.ts";

test.each([
  [{ id: 1, login: "automation", type: "Bot" }, true],
  [{ id: 1, login: "person[bot]", type: "User" }, false],
  [{ id: 1, login: "automation[bot]" }, true],
  [{ id: 1, login: "person", type: null }, false],
  [{ id: 1, login: "automation[bot]", type: null }, true],
  [{ id: 1, login: "person" }, false],
])("preserves account type and classifies %j", (payload, expected) => {
  const user = UserSchema.parse(payload);
  expect(user.type).toBe("type" in payload ? payload.type : undefined);
  expect(isGithubBot(user)).toBe(expected);
});

test("handles missing and deleted users without inventing an account type", () => {
  expect(isGithubBot(null)).toBe(false);
  expect(isGithubBot(undefined)).toBe(false);
  expect(isGithubBot(GHOST_USER)).toBe(false);
  expect(isGithubBot(UNKNOWN_USER)).toBe(false);
  const comment = GhIssueCommentSchema.parse({
    id: 1,
    body: "deleted author",
    user: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    author_association: "NONE",
  });
  expect(comment.user).toEqual(GHOST_USER);
  expect(comment.user?.type).toBeUndefined();
});
