import { describe, expect, it } from "vitest";
import type { AppRole } from "../lib/supabase";

/**
 * Mirrors the decision made by RequireRole + AuthProvider. Kept as a pure
 * function so the rule is testable without mounting React or Supabase.
 */
type GateInput = {
  role: AppRole | null;
  hasVerifiedFactor: boolean;
  currentLevel: "aal1" | "aal2" | null;
  nextLevel: "aal1" | "aal2" | null;
  allow: readonly AppRole[];
};

type GateResult = "allow" | "login" | "enroll" | "step-up" | "forbidden";

export function gate(input: GateInput): GateResult {
  const { role, hasVerifiedFactor, currentLevel, nextLevel, allow } = input;
  if (!role) return "login";

  const isStaff = role === "manager" || role === "admin";
  if (isStaff) {
    if (!hasVerifiedFactor) return "enroll";
    // Factor exists but this session hasn't used it yet.
    if (currentLevel === "aal1" && nextLevel === "aal2") return "step-up";
  }

  if (!allow.includes(role)) return "forbidden";
  return "allow";
}

const ADMIN: readonly AppRole[] = ["admin"];

describe("staff MFA gate", () => {
  it("sends an admin with no factor to enrolment", () => {
    expect(gate({ role: "admin", hasVerifiedFactor: false, currentLevel: "aal1", nextLevel: "aal2", allow: ADMIN })).toBe("enroll");
  });

  it("sends an admin with a factor but aal1 session to step-up", () => {
    expect(gate({ role: "admin", hasVerifiedFactor: true, currentLevel: "aal1", nextLevel: "aal2", allow: ADMIN })).toBe("step-up");
  });

  it("allows an admin at aal2", () => {
    expect(gate({ role: "admin", hasVerifiedFactor: true, currentLevel: "aal2", nextLevel: "aal2", allow: ADMIN })).toBe("allow");
  });

  it("treats a null role as logged out", () => {
    expect(gate({ role: null, hasVerifiedFactor: false, currentLevel: null, nextLevel: null, allow: ADMIN })).toBe("login");
  });

  it("does not demand MFA from customers", () => {
    expect(gate({ role: "customer", hasVerifiedFactor: false, currentLevel: "aal1", nextLevel: "aal1", allow: ["customer"] })).toBe("allow");
  });

  it("still forbids the wrong role even at aal2", () => {
    expect(gate({ role: "manager", hasVerifiedFactor: true, currentLevel: "aal2", nextLevel: "aal2", allow: ADMIN })).toBe("forbidden");
  });

  it("never lets an aal1 admin through to the admin area", () => {
    for (const allow of [ADMIN, ["admin", "manager"], ["manager", "admin", "rider"]] as const) {
      expect(gate({ role: "admin", hasVerifiedFactor: true, currentLevel: "aal1", nextLevel: "aal2", allow })).not.toBe("allow");
    }
  });
});
