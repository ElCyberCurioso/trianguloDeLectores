import { describe, it, expect } from 'vitest';
import { copiaDelSitioProcede } from '../../src/server/services/backup';

/**
 * Quién decide que la copia del sitio se haga sola.
 *
 * Es una función aparte y no un `if` dentro del cron por una razón práctica:
 * el manejador programado no se puede invocar desde un test de integración, así
 * que la decisión —que es lo que de verdad hay que comprobar— se prueba aquí.
 *
 * El criterio es una lista blanca, no una negra: un entorno nuevo no hereda la
 * copia por descuido, y si alguien escribe mal el nombre del entorno el fallo
 * es que no se copia, no que se copie donde no debe.
 */
describe('cuándo se programa la copia del sitio público', () => {
  it('sólo en producción', () => {
    expect(copiaDelSitioProcede({ ENVIRONMENT: 'production' })).toBe(true);
  });

  it('nunca en staging ni en desarrollo', () => {
    expect(copiaDelSitioProcede({ ENVIRONMENT: 'staging' })).toBe(false);
    expect(copiaDelSitioProcede({ ENVIRONMENT: 'development' })).toBe(false);
  });

  it('un entorno que no reconoce no se copia', () => {
    for (const entorno of ['', 'Production', 'prod', 'pruebas'] as const) {
      expect(copiaDelSitioProcede({ ENVIRONMENT: entorno as 'production' }), entorno).toBe(false);
    }
  });
});
