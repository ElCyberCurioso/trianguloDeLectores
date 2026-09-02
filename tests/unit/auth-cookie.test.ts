import { describe, it, expect } from 'vitest';
import { sessionCookieName } from '../../src/server/lib/auth';

/**
 * El prefijo `__Host-` es lo que separa la sesión del panel de la del
 * subdominio de la biblioteca: el navegador sólo acepta una cookie con ese
 * nombre si va `Secure`, con `Path=/` y **sin `Domain`**, lo que la ata al host
 * exacto que la emitió.
 */
describe('nombre de la cookie de sesión', () => {
  it('lleva prefijo __Host- fuera de desarrollo', () => {
    expect(sessionCookieName({ ENVIRONMENT: 'production' })).toBe('__Host-tdl_session');
    expect(sessionCookieName({ ENVIRONMENT: 'staging' })).toBe('__Host-tdl_session');
  });

  it('en desarrollo va sin prefijo, porque se sirve por http', () => {
    expect(sessionCookieName({ ENVIRONMENT: 'development' })).toBe('tdl_session');
  });
});
