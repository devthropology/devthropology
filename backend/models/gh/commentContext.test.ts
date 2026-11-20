import { describe, expect, it } from "vitest";
import { GhCommentSchema } from "./comment.ts";

const comment = {
  id: 1,
  path: "example.ts",
  body: "feedback",
  user: { id: 2, login: "reviewer" },
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  author_association: "MEMBER",
};

describe("review comment context", () => {
  it("accepts older payloads with no context or reactions", () => {
    const parsed = GhCommentSchema.parse(comment);
    expect(parsed.pull_request_review_id).toBeUndefined();
    expect(parsed.in_reply_to_id).toBeUndefined();
    expect(parsed.reactions).toBeUndefined();
    expect(parsed.reactions_observed_at).toBeUndefined();
  });

  it("retains null locations and zero reactions without retaining redundant API fields", () => {
    const reactions = {
      "+1": 0,
      "-1": 0,
      laugh: 0,
      hooray: 0,
      confused: 0,
      heart: 0,
      rocket: 0,
      eyes: 0,
    };
    const parsed = GhCommentSchema.parse({
      ...comment,
      line: null,
      original_line: 12,
      diff_hunk: "code\u0000context",
      reactions: {
        ...reactions,
        url: "https://api.github.com/reactions",
        total_count: 0,
      },
      html_url: "https://github.com/comment",
    });
    expect(parsed.line).toBeNull();
    expect(parsed.original_line).toBe(12);
    expect(parsed.diff_hunk).toBe("codecontext");
    expect(parsed.reactions).toEqual(reactions);
    expect(parsed).not.toHaveProperty("html_url");
  });
});
