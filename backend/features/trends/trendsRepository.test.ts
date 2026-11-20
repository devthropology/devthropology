import { test } from "vitest";
import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { normalizeAiAssistedModel } from "./trendsRepository.ts";

test("normalizeAiAssistedModel lightly remaps provider-prefixed Opus 4.5 labels", () => {
  assertEquals(
    normalizeAiAssistedModel("Claude Sonnet 4.5"),
    "Claude Sonnet 4.5",
  );
  assertEquals(
    normalizeAiAssistedModel(
      "Claude Us.Anthropic.Claude-Opus-4-5-20251101-V1:0",
    ),
    "Claude Opus 4.5",
  );
  assertEquals(
    normalizeAiAssistedModel(
      "Claude (us.anthropic.claude-opus-4-5-20251101-v1:0)",
    ),
    "Claude Opus 4.5",
  );
  assertEquals(
    normalizeAiAssistedModel(
      "Claude (global.anthropic.claude-sonnet-4-6-20260101-v1:0)",
    ),
    "Claude Sonnet 4.6",
  );
  assertEquals(
    normalizeAiAssistedModel("Claude Opus 4.6 (1m Context)"),
    "Claude Opus 4.6 (1m Context)",
  );
});
