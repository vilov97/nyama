import { describe, expect, it } from "vitest";
import { canAccess, homeForRole } from "./roles";

describe("canAccess (route-guard logic, audit T-RBAC)", () => {
  it("allows a role present in the allow-list", () => {
    expect(canAccess("manager", ["manager", "admin"])).toBe(true);
  });

  it("denies a role absent from the allow-list", () => {
    expect(canAccess("customer", ["manager", "admin"])).toBe(false);
    expect(canAccess("rider", ["rider"])).toBe(true);
    expect(canAccess("rider", ["manager"])).toBe(false);
  });

  it("denies null/undefined roles (fail closed)", () => {
    expect(canAccess(null, ["customer", "rider", "manager", "admin"])).toBe(false);
    expect(canAccess(undefined, ["customer"])).toBe(false);
  });

  it("denies when the allow-list is empty", () => {
    expect(canAccess("admin", [])).toBe(false);
  });

  it("keeps the kitchen out of management routes and managers out of the cook queue", () => {
    expect(canAccess("kitchen", ["kitchen", "manager", "admin"])).toBe(true);
    expect(canAccess("rider", ["kitchen", "manager", "admin"])).toBe(false);
    expect(canAccess("customer", ["kitchen", "manager", "admin"])).toBe(false);
    // A cook has no business in the dispatch board or the admin console.
    expect(canAccess("kitchen", ["manager", "admin"])).toBe(false);
    expect(canAccess("kitchen", ["admin"])).toBe(false);
  });
});

describe("homeForRole (post-login routing)", () => {
  it("maps each role to its portal home", () => {
    expect(homeForRole("customer")).toBe("/app");
    expect(homeForRole("rider")).toBe("/ride");
    expect(homeForRole("kitchen")).toBe("/kitchen");
    expect(homeForRole("manager")).toBe("/manager");
    expect(homeForRole("admin")).toBe("/admin");
  });

  it("falls back to login for unknown roles", () => {
    expect(homeForRole(null)).toBe("/login");
    expect(homeForRole(undefined)).toBe("/login");
  });
});
