import { AUTH_SESSION_DURATION_DAYS } from "./constants";
import type { UserSession } from "./domain-types";
import { HttpError } from "./http";

export function bearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length).trim();
}

export function clientIdentifier(request: Request): string {
  const forwarded = request.headers.get("cf-connecting-ip")?.trim();
  if (forwarded) {
    return forwarded;
  }

  const realIp = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (realIp) {
    return realIp;
  }

  return "unknown";
}

export function normalizeAccount(value: string): string {
  const account = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,31}$/.test(account)) {
    throw new HttpError(400, "account_invalid");
  }
  return account;
}

export function requirePassword(value: string): void {
  if (value.trim().length < 6) {
    throw new HttpError(400, "password_too_short");
  }
}

export function generateSessionToken(): string {
  return crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
}

export function issueDeviceTokenStorageValue(deviceId: string): string {
  return `stored:${deviceId}`;
}

export function issueAuthSessionStorageValue(tokenHash: string): string {
  return `stored:${tokenHash.slice(0, 32)}`;
}

export function authSessionExpiryTimestamp(days = AUTH_SESSION_DURATION_DAYS): string {
  return new Date(Date.now() + days * 24 * 60 * 60_000).toISOString().slice(0, 19).replace("T", " ");
}

export function leaseExpiryTimestamp(minutes = 5): string {
  return new Date(Date.now() + minutes * 60_000).toISOString().slice(0, 19).replace("T", " ");
}

export function requireCatalogWriteAccess(session: UserSession): void {
  requireOwnerAccess(session);
}

export function requireOwnerAccess(session: UserSession): void {
  if (normalizeUserRole(session.role) !== "owner") {
    throw new HttpError(403, "owner_required");
  }
}

export function normalizeUserRole(value: unknown): "owner" | "staff" | "printer" {
  if (value === "owner" || value === "staff" || value === "printer") {
    return value;
  }
  return "staff";
}
