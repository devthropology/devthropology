import { test } from "vitest";
import { computeRoundsOfReviews } from "../../backfill/reviewRounds.ts";
import { deepStrictEqual as assertEquals } from "node:assert/strict";

test("no round: empty input", () => {
  const commits: Array<[number, Date]> = [];
  const comments: Array<[number, Date]> = [];
  const rounds = computeRoundsOfReviews(0, commits, comments);
  assertEquals(rounds, 0);
});

test("no round: only commits", () => {
  const commits: Array<[number, Date]> = [
    [0, new Date("2023-05-21T10:00:00Z")],
    [0, new Date("2023-05-21T11:00:00Z")],
  ];
  const comments: Array<[number, Date]> = [];
  const rounds = computeRoundsOfReviews(0, commits, comments);
  assertEquals(rounds, 0);
});

test("no round: only comments", () => {
  const commits: Array<[number, Date]> = [];
  const comments: Array<[number, Date]> = [
    [1, new Date("2023-05-21T09:00:00Z")],
    [1, new Date("2023-05-21T10:00:00Z")],
  ];
  const rounds = computeRoundsOfReviews(0, commits, comments);
  assertEquals(rounds, 0);
});

test("no round: commit, comment (author), commit", () => {
  const commits: Array<[number, Date]> = [
    [0, new Date("2023-05-21T09:00:00Z")],
    [0, new Date("2023-05-21T11:00:00Z")],
  ];
  const comments: Array<[number, Date]> = [
    [0, new Date("2023-05-21T10:00:00Z")],
  ];
  const rounds = computeRoundsOfReviews(0, commits, comments);
  assertEquals(rounds, 0);
});

test("one round: comment, commit commit, comment", () => {
  const commits: Array<[number, Date]> = [
    [0, new Date("2023-05-21T10:00:00Z")],
    [0, new Date("2023-05-21T11:00:00Z")],
  ];
  const comments: Array<[number, Date]> = [
    [1, new Date("2023-05-21T09:00:00Z")],
    [1, new Date("2023-05-21T12:00:00Z")],
  ];
  const rounds = computeRoundsOfReviews(0, commits, comments);
  assertEquals(rounds, 1);
});

test("one round: comment, commit, comment (author), commit, comment", () => {
  const commits: Array<[number, Date]> = [
    [0, new Date("2023-05-21T10:00:00Z")],
    [0, new Date("2023-05-21T11:00:00Z")],
  ];
  const comments: Array<[number, Date]> = [
    [1, new Date("2023-05-21T09:00:00Z")],
    [0, new Date("2023-05-21T10:01:00Z")],
    [1, new Date("2023-05-21T12:00:00Z")],
  ];
  const rounds = computeRoundsOfReviews(0, commits, comments);
  assertEquals(rounds, 1);
});
