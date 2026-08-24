import { describe, it, expect } from 'vitest';
import {
  hashPassword, verifyPassword, timingSafeEqual, randomToken, sha256Hex, hmacHex, pseudonymize,
} from '../../src/server/lib/crypto';

describe('hashing de contraseñas', () => {
  it('produce un hash con el formato esperado y sal distinta cada vez', async () => {
    const a = await hashPassword('ContraseñaSegura123', 1000);
    const b = await hashPassword('ContraseñaSegura123', 1000);
    expect(a).toMatch(/^pbkdf2\$sha256\$1000\$[^$]+\$[^$]+$/);
    expect(a).not.toBe(b); // sal aleatoria
  });

  it('verifica correctamente', async () => {
    const hash = await hashPassword('ContraseñaSegura123', 1000);
    expect((await verifyPassword('ContraseñaSegura123', hash)).valid).toBe(true);
    expect((await verifyPassword('otra', hash)).valid).toBe(false);
  });

  it('marca para rehash los hashes con menos iteraciones', async () => {
    const hash = await hashPassword('ContraseñaSegura123', 1000);
    const result = await verifyPassword('ContraseñaSegura123', hash);
    expect(result.needsRehash).toBe(true);
  });

  it('rechaza hashes malformados sin lanzar', async () => {
    for (const bad of ['', 'no-es-un-hash', 'pbkdf2$md5$1000$a$b', 'pbkdf2$sha256$abc$a$b']) {
      const result = await verifyPassword('x', bad);
      expect(result.valid).toBe(false);
    }
  });

  it('nunca guarda la contraseña en claro dentro del hash', async () => {
    const hash = await hashPassword('MiClaveSuperSecreta123', 1000);
    expect(hash).not.toContain('MiClaveSuperSecreta123');
  });
});

describe('timingSafeEqual', () => {
  it('compara correctamente', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });
});

describe('tokens aleatorios', () => {
  it('genera tokens url-safe y sin repetir', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => randomToken(32)));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe('hashes', () => {
  it('sha256Hex es estable', async () => {
    expect(await sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('hmacHex depende de la clave', async () => {
    expect(await hmacHex('k1', 'm')).not.toBe(await hmacHex('k2', 'm'));
  });
});

describe('pseudonimización (GDPR)', () => {
  it('no devuelve la IP en claro', async () => {
    const hash = await pseudonymize('203.0.113.9', 'pepper');
    expect(hash).not.toContain('203.0.113.9');
    expect(hash).toHaveLength(32);
  });

  it('es determinista con el mismo pepper', async () => {
    expect(await pseudonymize('1.2.3.4', 'p')).toBe(await pseudonymize('1.2.3.4', 'p'));
  });

  it('cambia con el pepper', async () => {
    expect(await pseudonymize('1.2.3.4', 'p1')).not.toBe(await pseudonymize('1.2.3.4', 'p2'));
  });

  it('devuelve null sin pepper en vez de un hash débil', async () => {
    expect(await pseudonymize('1.2.3.4', undefined)).toBeNull();
    expect(await pseudonymize(null, 'p')).toBeNull();
  });
});
