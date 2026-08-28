/**
 * Primitivas criptográficas — 100% WebCrypto (disponible en workerd).
 *
 * Nota sobre el hashing de contraseñas:
 * Workers no dispone de Argon2id ni bcrypt nativos, y las implementaciones WASM
 * añaden peso al bundle y consumen el presupuesto de CPU. PBKDF2-HMAC-SHA256 es
 * la primitiva de derivación aprobada por OWASP disponible de forma nativa en
 * WebCrypto, y al ejecutarse en código nativo (no JS) el coste real es de pocas
 * decenas de ms. El número de iteraciones se guarda dentro del propio hash, así
 * que se puede subir en el futuro y re-hashear de forma transparente en el login.
 *
 * **Techo de la plataforma**: WebCrypto en Workers rechaza más de 100.000
 * iteraciones (`NotSupportedError`). OWASP recomienda hoy 600.000, así que el
 * factor de trabajo lo impone el runtime, no nosotros. Se compensa con lo que sí
 * está en nuestra mano: límite de intentos por IP y global, bloqueo de la cuenta
 * tras varios fallos y Turnstile en el formulario de acceso.
 */

const enc = new TextEncoder();

export const PBKDF2_ITERATIONS = 100_000;

/** Máximo que acepta WebCrypto en Workers. Por encima lanza NotSupportedError. */
const PBKDF2_MAX_ITERATIONS = 100_000;
const PBKDF2_HASH = 'SHA-256';
const KEY_LEN_BITS = 256;

function toB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export function randomBytes(len: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(len));
}

/** Token opaco base64url de 256 bits. Usado para cookies de sesión y CSRF. */
export function randomToken(bytes = 32): string {
  return toB64(randomBytes(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomId(): string {
  return crypto.randomUUID();
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? enc.encode(input) : input;
  return toHex(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

/** Comparación en tiempo constante sobre strings ASCII/hex. */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Longitudes distintas: seguimos comparando para no filtrar por tiempo.
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return diff === 0;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: PBKDF2_HASH },
    key,
    KEY_LEN_BITS,
  );
  return new Uint8Array(bits);
}

/** Formato: `pbkdf2$sha256$<iteraciones>$<salt b64>$<hash b64>` */
export async function hashPassword(password: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, iterations);
  return `pbkdf2$sha256$${iterations}$${toB64(salt)}$${toB64(hash)}`;
}

export interface VerifyResult {
  valid: boolean;
  /** true si el hash usa parámetros obsoletos y conviene re-hashear al hacer login */
  needsRehash: boolean;
}

export async function verifyPassword(password: string, stored: string): Promise<VerifyResult> {
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') {
    return { valid: false, needsRehash: false };
  }
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1000 || iterations > PBKDF2_MAX_ITERATIONS) {
    return { valid: false, needsRehash: false };
  }
  let salt: Uint8Array;
  try {
    salt = fromB64(parts[3]!);
  } catch {
    return { valid: false, needsRehash: false };
  }
  const derived = await pbkdf2(password, salt, iterations);
  const valid = timingSafeEqual(toB64(derived), parts[4]!);
  return { valid, needsRehash: valid && iterations < PBKDF2_ITERATIONS };
}

/**
 * Pseudonimiza un identificador (IP, user-agent) con HMAC + pepper.
 * GDPR: nunca persistimos la IP en claro. Sin pepper configurado devolvemos null
 * en vez de un hash débil sin sal.
 */
export async function pseudonymize(value: string | null | undefined, pepper: string | undefined): Promise<string | null> {
  if (!value || !pepper) return null;
  return (await hmacHex(pepper, value)).slice(0, 32);
}
