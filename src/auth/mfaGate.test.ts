import { describe, expect, it } from "vitest";
import type { AppRole } from "../lib/supabase";
import { staffMfaRequired } from "./roles";

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
  appMetadata?: Record<string, unknown>;
};

type GateResult = "allow" | "login" | "enroll" | "step-up" | "forbidden";

export function gate(input: GateInput): GateResult {
  const { role, hasVerifiedFactor, currentLevel, nextLevel, allow, appMetadata } = input;
  if (!role) return "login";

  if (staffMfaRequired(role, appMetadata)) {
    if (!hasVerifiedFactor) return "enroll";
    // Factor exists but this session hasn't used it yet.
    if (currentLevel === "aal1" && nextLevel === "aal2") return "step-up";
  }

  if (!allow.includes(role)) return "forbidden";
  return "allow";
}

const ADMIN: readonly AppRole[] = ["admin"];
const MANAGER: readonly AppRole[] = ["manager", "admin"];

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

  it("sends a manager with no factor to enrolment", () => {
    expect(gate({ role: "manager", hasVerifiedFactor: false, currentLevel: "aal1", nextLevel: "aal1", allow: MANAGER })).toBe("enroll");
  });

  it("lets the exempt test manager in on a password alone", () => {
    expect(gate({ role: "manager", hasVerifiedFactor: false, currentLevel: "aal1", nextLevel: "aal1", allow: MANAGER, appMetadata: { mfa_exempt: true } })).toBe("allow");
  });

  it("keeps the exempt manager out of the admin area", () => {
    expect(gate({ role: "manager", hasVerifiedFactor: false, currentLevel: "aal1", nextLevel: "aal1", allow: ADMIN, appMetadata: { mfa_exempt: true } })).toBe("forbidden");
  });

  it("never exempts an admin, whatever the flag says", () => {
    expect(gate({ role: "admin", hasVerifiedFactor: false, currentLevel: "aal1", nextLevel: "aal1", allow: ADMIN, appMetadata: { mfa_exempt: true } })).toBe("enroll");
    expect(gate({ role: "admin", hasVerifiedFactor: true, currentLevel: "aal1", nextLevel: "aal2", allow: ADMIN, appMetadata: { mfa_exempt: true } })).toBe("step-up");
  });

  it("accepts only the boolean true as an exemption", () => {
    for (const value of ["true", 1, "yes", {}, null, undefined, false]) {
      expect(gate({ role: "manager", hasVerifiedFactor: false, currentLevel: "aal1", nextLevel: "aal1", allow: MANAGER, appMetadata: { mfa_exempt: value } })).toBe("enroll");
    }
  });

  it("never lets an aal1 admin through to the admin area", () => {
    for (const allow of [ADMIN, ["admin", "manager"], ["manager", "admin", "rider"]] as const) {
      expect(gate({ role: "admin", hasVerifiedFactor: true, currentLevel: "aal1", nextLevel: "aal2", allow })).not.toBe("allow");
    }
  });
});
