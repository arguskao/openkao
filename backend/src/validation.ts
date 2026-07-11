import { HttpError } from "./http";

const MAX_JSON_BODY_BYTES = 64 * 1024;

export async function readJson<T>(request: Request): Promise<T> {
  const contentLength = request.headers.get("content-length");
  if (contentLength) {
    const parsedLength = Number(contentLength);
    if (!Number.isFinite(parsedLength) || parsedLength < 0) {
      throw new HttpError(400, "content_length_invalid");
    }
    if (parsedLength > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, "request_body_too_large");
    }
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType && !contentType.includes("application/json")) {
    throw new HttpError(415, "content_type_invalid");
  }

  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).length > MAX_JSON_BODY_BYTES) {
      throw new HttpError(413, "request_body_too_large");
    }

    const parsed = JSON.parse(raw) as unknown;
    if (parsed == null || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new HttpError(400, "json_object_required");
    }

    return parsed as T;
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    throw new HttpError(400, "invalid_json");
  }
}

export function requireArray(
  value: unknown,
  field: string,
  options: { min?: number; max?: number } = {}
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${field}_invalid`);
  }

  if (options.min != null && value.length < options.min) {
    throw new HttpError(400, `${field}_required`);
  }

  if (options.max != null && value.length > options.max) {
    throw new HttpError(400, `${field}_too_many`);
  }
}

export function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new HttpError(400, `${field}_required`);
  }
}

export function requireIntegerRange(
  value: unknown,
  field: string,
  options: { min: number; max: number }
): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < options.min ||
    value > options.max
  ) {
    throw new HttpError(400, `${field}_invalid`);
  }
}
