import { describe, expect, it } from "vitest";
import type { AuthError } from "@supabase/supabase-js";
import { authErrorDetail, describeAuthError } from "./authErrors";

const err = (over: Partial<AuthError> & { message: string }): AuthError =>
  ({ name: "AuthApiError", status: 400, code: undefined, ...over }) as AuthError;

describe("describeAuthError", () => {
  it("keeps credential failures neutral (anti-enumeration)", () => {
    const e = err({ message: "Invalid login credentials", code: "invalid_credentials" });
    expect(describeAuthError(e)).toBe("Invalid email or password. Please try again.");
  });

  it("keeps unconfirmed-email neutral too", () => {
    const e = err({ message: "Email not confirmed", code: "email_not_confirmed" });
    expect(describeAuthError(e)).toBe("Invalid email or password. Please try again.");
  });

  it("surfaces network/CORS failures instead of 'invalid credentials'", () => {
    const e = err({ message: "Failed to fetch", status: 0, code: "request_failed" });
    expect(describeAuthError(e)).toMatch(/Could not reach the authentication service/);
  });

  it("treats status 0 as a network failure even without a code", () => {
    const e = err({ message: "TypeError: Load failed", status: 0 });
    expect(describeAuthError(e)).toMatch(/Could not reach the authentication service/);
  });

  it("explains rate limiting", () => {
    const e = err({ message: "email rate limit exceeded", status: 429, code: "over_email_send_rate_limit" });
    expect(describeAuthError(e)).toMatch(/Too many attempts/);
  });

  it("flags server-side failures without blaming the user", () => {
    const e = err({ message: "Internal Server Error", status: 503 });
    expect(describeAuthError(e)).toMatch(/having trouble/);
  });

  it("returns null for errors the page should phrase itself", () => {
    expect(describeAuthError(err({ message: "Password should be at least 6 characters", code: "weak_password" }))).toBeNull();
    expect(describeAuthError(null)).toBeNull();
    expect(describeAuthError(undefined)).toBeNull();
  });
});

describe("authErrorDetail", () => {
  it("joins code, status and message", () => {
    const e = err({ message: "Failed to fetch", status: 0, code: "request_failed" });
    expect(authErrorDetail(e)).toBe("code: request_failed · message: Failed to fetch");
  });

  it("is null when there is no error", () => {
    expect(authErrorDetail(null)).toBeNull();
  });
});
