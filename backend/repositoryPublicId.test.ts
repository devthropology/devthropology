import { deepStrictEqual as assertEquals } from "node:assert/strict";
import { describe, it } from "vitest";
import {
  decodeRepositoryId,
  encodeRepositoryId,
  resolveRepositoryRef,
} from "./repositoryPublicId.ts";

describe("repositoryPublicId", () => {
  it("round-trips encoded repository ids", () => {
    for (const repositoryId of [0, 1, 42, 123, 999999]) {
      assertEquals(
        decodeRepositoryId(encodeRepositoryId(repositoryId)),
        repositoryId,
      );
    }
  });

  it("keeps fixed public ids stable", () => {
    assertEquals(encodeRepositoryId(1), "6khJ");
    assertEquals(encodeRepositoryId(42), "LgYX");
    assertEquals(encodeRepositoryId(123), "AZhT");
    assertEquals(encodeRepositoryId(999999), "5P9wU");
  });

  it("returns null for invalid public ids", () => {
    assertEquals(decodeRepositoryId(""), null);
    assertEquals(decodeRepositoryId("not-a-real-repo-ref"), null);
  });

  it("supports legacy numeric repository refs during migration", () => {
    assertEquals(resolveRepositoryRef("123"), 123);
    assertEquals(resolveRepositoryRef(encodeRepositoryId(123)), 123);
  });
});
