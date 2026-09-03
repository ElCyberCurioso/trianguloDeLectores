import type { Bindings } from '../../types/env';

/**
 * Distribución del APK de la aplicación Android.
 *
 * El fichero vive en R2, no en `public/`: los assets del Worker se despliegan
 * con el código, así que meter ahí 15 MB de binario obligaría a subirlo en cada
 * despliegue del sitio y a versionarlo en git. En R2 se publica cuando hay
 * versión nueva y el sitio lo sirve tal cual.
 *
 * El prefijo es `apps/android/`, distinto de todo lo demás. `isSafeMediaKey()`
 * sigue reconociendo sólo `reviews/covers/`, así que la ruta pública `/media/*`
 * tampoco puede servir esto: sale por su ruta, con su tipo y su cabecera de
 * descarga.
 */
export const APK_PREFIX = 'apps/android/';

/** Manifiesto de la última versión publicada. */
export const APK_MANIFEST_KEY = `${APK_PREFIX}latest.json`;

/** Nombre con el que se descarga. Fijo: los enlaces de fuera no deben romperse. */
export const APK_FILENAME = 'triangulo-de-lectores.apk';

export const APK_CONTENT_TYPE = 'application/vnd.android.package-archive';

export interface ApkManifest {
  /** Versión legible, «1.2.0». */
  version: string;
  /** `versionCode` del manifiesto de Android. Es lo que compara la aplicación. */
  versionCode: number;
  /** Clave del binario en R2. Nunca llega al cliente. */
  key: string;
  sizeBytes: number;
  /** SHA-256 en hexadecimal, para poder comprobar la descarga a mano. */
  sha256: string;
  publishedAt: string;
  minSdk: number;
  notes: string | null;
}

const SAFE_APK_KEY = /^apps\/android\/[a-z0-9.-]{1,60}\.apk$/;

/** Sólo claves con la forma que genera el script de publicación. */
export function isSafeApkKey(key: string): boolean {
  if (key.length > 120 || key.includes('..') || key.includes('//') || key.includes('%')) return false;
  return SAFE_APK_KEY.test(key);
}

/**
 * Lee el manifiesto publicado. Devuelve `null` cuando todavía no hay ninguna
 * versión: la página lo dice en vez de reventar, que es lo que pasa el primer
 * día en un entorno nuevo.
 */
export async function readApkManifest(env: Pick<Bindings, 'MEDIA'>): Promise<ApkManifest | null> {
  const object = await env.MEDIA.get(APK_MANIFEST_KEY);
  if (!object) return null;

  try {
    const parsed = (await object.json()) as Partial<ApkManifest>;
    if (
      typeof parsed.version !== 'string' ||
      typeof parsed.versionCode !== 'number' ||
      typeof parsed.key !== 'string' ||
      !isSafeApkKey(parsed.key)
    ) {
      return null;
    }
    return {
      version: parsed.version,
      versionCode: parsed.versionCode,
      key: parsed.key,
      sizeBytes: typeof parsed.sizeBytes === 'number' ? parsed.sizeBytes : 0,
      sha256: typeof parsed.sha256 === 'string' ? parsed.sha256 : '',
      publishedAt: typeof parsed.publishedAt === 'string' ? parsed.publishedAt : '',
      minSdk: typeof parsed.minSdk === 'number' ? parsed.minSdk : 0,
      notes: typeof parsed.notes === 'string' && parsed.notes.length ? parsed.notes : null,
    };
  } catch {
    // Un manifiesto ilegible es un fallo de publicación, no del visitante: la
    // página se pinta sin descarga y el fallo se ve en los logs.
    return null;
  }
}

/** Tamaño en MB con una cifra decimal y coma, como el resto de números del sitio. */
export function formatApkSize(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1).replace('.', ',')} MB`;
}
