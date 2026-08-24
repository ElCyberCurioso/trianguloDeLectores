/**
 * Lectura defensiva de cuerpos de formulario.
 * `parseBody({ all: true })` devuelve string | File | (string | File)[]; estos
 * helpers normalizan a tipos concretos y recortan longitudes.
 */

export type BodyValue = string | File | (string | File)[] | undefined;
export type ParsedBody = Record<string, BodyValue>;

export function str(body: ParsedBody, key: string, maxLen = 4000): string | undefined {
  const raw = body[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length ? trimmed.slice(0, maxLen) : undefined;
}

export function strOrEmpty(body: ParsedBody, key: string, maxLen = 4000): string {
  return str(body, key, maxLen) ?? '';
}

export function strArray(body: ParsedBody, key: string, maxItems = 50): string[] {
  const raw = body[key];
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((v): v is string => typeof v === 'string' && v.length > 0).slice(0, maxItems);
}

export function num(body: ParsedBody, key: string): number | undefined {
  const value = str(body, key, 32);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Checkbox HTML: presente => true, ausente => false. */
export function bool(body: ParsedBody, key: string): boolean {
  const value = str(body, key, 16);
  return value === '1' || value === 'true' || value === 'on';
}

export function file(body: ParsedBody, key: string): File | undefined {
  const raw = body[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value instanceof File ? value : undefined;
}

/** Divide un campo "a; b; c" en lista limpia. */
export function splitList(value: string | undefined, separator = ';', maxItems = 10): string[] {
  if (!value) return [];
  return value
    .split(separator)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, maxItems);
}

/**
 * Lista posicional en bruto: conserva los valores vacíos.
 * Imprescindible para los grupos de campos repetidos del editor (una fila de
 * plataforma sin URL no debe desalinear las demás columnas).
 */
export function rawList(body: ParsedBody, key: string, maxItems = 50): string[] {
  const raw = body[key];
  if (raw === undefined) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((v) => (typeof v === 'string' ? v.trim() : '')).slice(0, maxItems);
}
