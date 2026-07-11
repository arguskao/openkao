export async function hashDeviceToken(token: string): Promise<string> {
  return sha256Hex(`device:${token}`);
}

export async function hashAuthSessionToken(token: string): Promise<string> {
  return sha256Hex(`auth:${token}`);
}

export async function hashAdminToken(token: string): Promise<string> {
  return sha256Hex(`admin:${token}`);
}

export async function hashPassword(password: string): Promise<string> {
  const iterations = 100_000;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePasswordHash(password, salt, iterations);
  return `pbkdf2_sha256$${iterations}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationsValue, saltValue, hashValue] = encoded.split("$");
  if (algorithm !== "pbkdf2_sha256" || !iterationsValue || !saltValue || !hashValue) {
    return false;
  }

  const iterations = Number(iterationsValue);
  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false;
  }

  const derived = await derivePasswordHash(password, fromBase64(saltValue), iterations);
  return timingSafeEqual(derived, fromBase64(hashValue));
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function derivePasswordHash(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations
    },
    keyMaterial,
    256
  );

  return new Uint8Array(bits);
}

function toBase64(value: Uint8Array): string {
  let output = "";
  for (const byte of value) {
    output += String.fromCharCode(byte);
  }
  return btoa(output);
}

function fromBase64(value: string): Uint8Array {
  const decoded = atob(value);
  const output = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    output[index] = decoded.charCodeAt(index);
  }
  return output;
}

function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left[index] ^ right[index];
  }
  return mismatch === 0;
}
