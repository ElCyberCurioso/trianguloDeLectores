import { MAX_IMAGE_BYTES } from './images';

/**
 * Descarga de una imagen indicada por URL.
 *
 * Esto es una petición saliente cuyo destino elige quien rellena un formulario,
 * o sea **superficie de SSRF**. Que detrás haya una sesión de administrador
 * reduce el riesgo, no lo elimina: una URL pegada de cualquier sitio puede
 * apuntar a donde no debe. De ahí las guardas.
 *
 * Lo que se descarga se guarda siempre en R2 y se sirve desde ahí. Nunca se
 * deja la URL de un tercero en un `src`: si mañana ese servidor cambia la
 * imagen, la borra o registra a quien la mira, no es problema nuestro.
 */

/** Si tarda más, no merece la pena tener a nadie esperando. */
const TIMEOUT_MS = 8000;

export type RemoteImageError =
  | 'invalid_url'
  | 'blocked_host'
  | 'fetch_failed'
  | 'not_an_image'
  | 'too_large';

/**
 * Nombres que no deben alcanzarse nunca desde aquí.
 *
 * En Workers no hay resolución de DNS a mano, así que no se puede comprobar a
 * qué IP apunta un nombre: lo que sí se puede es cerrar el paso a lo que ya
 * viene escrito como dirección interna. El borde de Cloudflare no encamina a
 * redes privadas, con lo que esto es la segunda barrera, no la única.
 */
function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.home.arpa')) return true;
  // Metadatos de proveedores de nube: el destino clásico de un SSRF.
  if (host === 'metadata.google.internal' || host === 'instance-data') return true;

  // IPv4 literal: se bloquean los rangos privados y los reservados.
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local y metadatos de EC2
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a >= 224) return true; // multicast y reservados
    return false;
  }

  // IPv6 literal: se bloquea entero. Ninguna portada legítima llega así.
  if (host.startsWith('[') || host.includes(':')) return true;

  return false;
}

/** ¿Se puede ir a buscar una imagen a esta URL? */
export function isAllowedRemoteImageUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  // `javascript:`, `data:`, `file:` y compañía quedan fuera por no estar aquí.
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  // Un puerto raro casi siempre significa un servicio interno, no una imagen.
  if (url.port && url.port !== '80' && url.port !== '443') return false;
  if (!url.hostname || isBlockedHost(url.hostname)) return false;
  return true;
}

export interface RemoteImage {
  bytes: Uint8Array;
  declaredType: string | null;
}

export async function fetchRemoteImage(
  raw: string,
): Promise<{ ok: true; value: RemoteImage } | { ok: false; error: RemoteImageError }> {
  if (!isAllowedRemoteImageUrl(raw)) {
    return { ok: false, error: raw.startsWith('http') ? 'blocked_host' : 'invalid_url' };
  }

  let response: Response;
  try {
    response = await fetch(raw, {
      headers: { Accept: 'image/*' },
      /*
       * Sin seguir saltos. Un redirect es la forma clásica de convertir una URL
       * permitida en una petición a donde no se debe: las guardas de arriba se
       * aplican a lo que se escribe, no a donde acabe llevando.
       */
      redirect: 'error',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, error: 'fetch_failed' };
  }

  if (!response.ok) return { ok: false, error: 'fetch_failed' };

  // `Content-Length` es un dato del servidor remoto: sirve para cortar pronto,
  // pero el límite de verdad lo pone el contador de abajo.
  const declaredLength = Number(response.headers.get('Content-Length') ?? '0');
  if (declaredLength > MAX_IMAGE_BYTES) return { ok: false, error: 'too_large' };

  const buffer = await readCapped(response, MAX_IMAGE_BYTES);
  if (!buffer) return { ok: false, error: 'too_large' };

  return {
    ok: true,
    value: { bytes: buffer, declaredType: response.headers.get('Content-Type') },
  };
}

/**
 * Lee el cuerpo con un techo real.
 *
 * Sin esto, un servidor que miente en `Content-Length` —o que no lo manda—
 * podría hacer que el Worker se tragase un flujo interminable.
 */
async function readCapped(response: Response, limit: number): Promise<Uint8Array | null> {
  if (!response.body) return null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > limit) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}
