import { describe, expect, it } from "vitest";

import { requireNonDemoUser } from "./adminAccess.server";

describe("requireNonDemoUser", () => {
  it("throws a 404 for demo users", () => {
    let thrown: unknown;

    try {
      requireNonDemoUser({ role: "demo" });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(404);
  });

  it("allows non-demo users", () => {
    expect(() => requireNonDemoUser({ role: "admin" })).not.toThrow();
    expect(() => requireNonDemoUser({ role: "user" })).not.toThrow();
  });
});
