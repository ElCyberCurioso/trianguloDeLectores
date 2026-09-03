import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { AppEnv, Bindings } from '../../types/env';
import { DeviceRepository, type ResolvedDevice } from '../../db/repos/devices';
import { randomToken, sha256Hex, pseudonymize } from './crypto';
import { forbidden, unauthorized, clientIp } from './http';

/**
 * Credencial de la aplicación Android.
 *
 * No se reutiliza la sesión del navegador, y no por comodidad:
 *
 *   - la cookie caduca a las 2 horas de inactividad y a las 12 en absoluto,
 *     que es lo correcto para un panel abierto en un portátil y absurdo para
 *     una aplicación que se abre a leer diez minutos cada noche;
 *   - el CSRF exige `Origin` o `Sec-Fetch-Site`, cabeceras que pone el
 *     navegador y que un cliente nativo no tiene por qué mandar;
 *   - una cookie viaja sola en cada petición, y esa es justamente la propiedad
 *     que hace falta protegerse del CSRF. Un token en `Authorization` no lo
 *     manda el navegador por su cuenta, así que aquí no hay nada que falsificar
 *     desde otro sitio.
 *
 * A cambio, el token dura mucho, y por eso se guarda hasheado, se ata a un
 * dispositivo con nombre y se puede revocar de uno en uno.
 */

/** 90 días. Se renueva sola mientras se use. */
export const DEVICE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Cada cuánto se toca `last_seen_at`. Escribir en cada petición convertiría
 * cada lectura de la aplicación en una escritura de D1 sin ganar precisión que
 * le sirva a nadie.
 */
export const DEVICE_TOUCH_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Techo de dispositivos vivos por persona. Un teléfono, una tableta, y sobra. */
export const MAX_DEVICES_PER_USER = 10;

export interface IssuedDevice {
  token: string;
  deviceId: string;
  expiresAt: number;
}

/**
 * Emite un token nuevo. Sale de aquí una única vez y en claro: lo que se
 * guarda es su SHA-256, así que si luego se pierde no hay forma de recuperarlo
 * y hay que volver a entrar. Igual que con las contraseñas, y por lo mismo.
 */
export async function issueDeviceToken(
  env: Bindings,
  userId: string,
  deviceName: string,
  ip: string | null,
): Promise<IssuedDevice> {
  const devices = new DeviceRepository(env);

  // 32 bytes de aleatoriedad criptográfica. Nada derivado del usuario ni del
  // nombre del dispositivo: el token no debe decir nada de quién lo tiene.
  const token = randomToken(32);
  const deviceId = crypto.randomUUID();
  const expiresAt = Date.now() + DEVICE_TTL_MS;

  await devices.create({
    id: deviceId,
    userId,
    tokenHash: await sha256Hex(token),
    deviceName,
    ipHash: await pseudonymize(ip, env.HASH_PEPPER),
    expiresAt,
  });

  return { token, deviceId, expiresAt };
}

/** Lee el token de la cabecera. Sólo `Bearer`, y sin espacios de más. */
export function readBearerToken(c: Context<AppEnv>): string | null {
  const header = c.req.header('Authorization');
  if (!header) return null;
  const match = /^Bearer ([A-Za-z0-9._~+/=-]{20,512})$/.exec(header.trim());
  return match ? match[1]! : null;
}

/**
 * Guardián de la API del móvil.
 *
 * Va antes que sus rutas, como el del subdominio: una ruta nueva de la
 * aplicación nace cerrada. El rol se lee de la base de datos en cada petición
 * —lo devuelve `resolve()` desde `users`—, nunca de nada que mande el cliente.
 */
export const requireDevice = createMiddleware<AppEnv>(async (c, next) => {
  const token = readBearerToken(c);
  if (!token) throw unauthorized('Falta la credencial del dispositivo');

  const devices = new DeviceRepository(c.env);
  const device = await devices.resolve(await sha256Hex(token));
  if (!device) throw unauthorized('La credencial del dispositivo no es válida o ha caducado');
  if (device.role !== 'ADMIN') throw forbidden('Esta aplicación requiere permisos de administrador');

  c.set('device', device);
  c.set('user', {
    id: device.userId,
    // El email no hace falta en esta API y no se trae de la base: lo que se
    // publica es lo mínimo para pintar «hola, fulano» en los ajustes.
    email: '',
    displayName: device.displayName,
    role: device.role,
  });

  // Renovación deslizante: mientras se use, el teléfono no vuelve a pedir la
  // contraseña. Se escribe como mucho una vez cada seis horas.
  if (Date.now() - device.lastSeenAt > DEVICE_TOUCH_INTERVAL_MS) {
    c.executionCtx.waitUntil(devices.touch(device.deviceId, Date.now() + DEVICE_TTL_MS));
  }

  await next();
});

/** El dispositivo de la petición en curso. Sólo se llama tras `requireDevice`. */
export function currentDevice(c: Context<AppEnv>): ResolvedDevice {
  const device = c.get('device');
  if (!device) throw unauthorized('Falta la credencial del dispositivo');
  return device;
}

/** Identidad para el limitador: el dispositivo, no la IP de la operadora. */
export function deviceIdentity(c: Context<AppEnv>): string {
  return c.get('device')?.deviceId ?? clientIp(c) ?? 'anonymous';
}
