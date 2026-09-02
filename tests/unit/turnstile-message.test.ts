import { describe, it, expect } from 'vitest';
import { turnstileMessageForCodes, shouldCheckTurnstile } from '../../src/server/lib/login';

/**
 * El caso que motivó esto: el widget no se pinta porque algo bloquea el script
 * de Cloudflare, el formulario viaja sin token y Cloudflare responde
 * `missing-input-response`. El mensaje tiene que decir qué está pasando, porque
 * quien lo sufre no ve ningún recuadro y no tiene forma de adivinarlo.
 */
describe('mensaje de la comprobación anti-bot', () => {
  it('sin token, señala al bloqueador del navegador', () => {
    const message = turnstileMessageForCodes(['missing-input-response']);
    expect(message).toMatch(/no ves el recuadro/i);
    expect(message).toMatch(/extensión|rastreadores/i);
  });

  it('token caducado, pide recargar', () => {
    expect(turnstileMessageForCodes(['timeout-or-duplicate'])).toMatch(/caducado/i);
  });

  it('clave mal configurada, avisa de que es del servidor', () => {
    expect(turnstileMessageForCodes(['missing-secret'])).toMatch(/servidor/i);
  });

  it('cualquier otro caso, mensaje genérico pero accionable', () => {
    expect(turnstileMessageForCodes(['bad-request'])).toMatch(/recarga/i);
  });
});

describe('cuándo se exige la comprobación', () => {
  it('se exige si está activada en los ajustes', () => {
    expect(shouldCheckTurnstile({}, true)).toBe(true);
  });

  it('no se exige si está desactivada', () => {
    expect(shouldCheckTurnstile({}, false)).toBe(false);
  });

  /**
   * El caso del subdominio de la biblioteca: su formulario no pinta el widget,
   * así que pedir el token era garantizar el 401. Un formulario sin widget
   * nunca debe exigir token, esté el ajuste como esté.
   */
  it('nunca se exige a un formulario que no pinta el widget', () => {
    expect(shouldCheckTurnstile({ requireTurnstile: false }, true)).toBe(false);
    expect(shouldCheckTurnstile({ requireTurnstile: false }, false)).toBe(false);
  });
});
