import { describe, it, expect } from 'vitest';
import {
  sanitizeHtml, escapeHtml, safeUrl, renderCommentBody, htmlToText,
} from '../../src/server/lib/sanitize';

describe('escapeHtml', () => {
  it('escapa los cinco caracteres peligrosos', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});

describe('safeUrl', () => {
  it('acepta http, https y mailto', () => {
    expect(safeUrl('https://example.com/a')).toContain('https://example.com/a');
    expect(safeUrl('http://example.com')).toContain('http://example.com');
    expect(safeUrl('mailto:hola@example.com')).toContain('mailto:');
  });

  it('acepta rutas relativas propias', () => {
    expect(safeUrl('/resena/dune')).toBe('/resena/dune');
    expect(safeUrl('#comentarios')).toBe('#comentarios');
  });

  it('rechaza esquemas peligrosos, incluso ofuscados', () => {
    const vectores = [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'java\nscript:alert(1)',
      'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ];
    for (const vector of vectores) {
      expect(safeUrl(vector), vector).toBeNull();
    }
  });

  it('rechaza URLs protocol-relative (evita salto de origen)', () => {
    expect(safeUrl('//evil.example')).toBeNull();
    expect(safeUrl('/\\evil.example')).toBeNull();
  });
});

describe('sanitizeHtml', () => {
  it('conserva el formato permitido', () => {
    const out = sanitizeHtml('<h2>Título</h2><p><strong>Negrita</strong> y <em>cursiva</em></p><ul><li>uno</li></ul>');
    expect(out).toContain('<h2>Título</h2>');
    expect(out).toContain('<strong>Negrita</strong>');
    expect(out).toContain('<li>uno</li>');
  });

  it('elimina <script> junto con su contenido', () => {
    const out = sanitizeHtml('<p>antes</p><script>alert(1)</script><p>después</p>');
    expect(out).not.toContain('alert');
    expect(out).not.toContain('script');
    expect(out).toContain('antes');
    expect(out).toContain('después');
  });

  it('elimina style, iframe, object y svg con su contenido', () => {
    for (const tag of ['style', 'iframe', 'object', 'svg', 'noscript', 'template']) {
      const out = sanitizeHtml(`<${tag}>PAYLOAD</${tag}>`);
      expect(out, tag).not.toContain('PAYLOAD');
    }
  });

  it('elimina manejadores de eventos', () => {
    const out = sanitizeHtml('<p onclick="alert(1)" onmouseover=alert(2)>hola</p>');
    expect(out).toBe('<p>hola</p>');
  });

  it('elimina el atributo style', () => {
    expect(sanitizeHtml('<p style="position:fixed">x</p>')).toBe('<p>x</p>');
  });

  it('descarta enlaces con javascript: y conserva los válidos con rel seguro', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a>x</a>');
    const ok = sanitizeHtml('<a href="https://example.com">x</a>');
    expect(ok).toContain('rel="noopener noreferrer nofollow"');
    expect(ok).toContain('target="_blank"');
  });

  it('sólo deja pasar las clases de la allowlist', () => {
    expect(sanitizeHtml('<span class="spoiler">x</span>')).toContain('class="spoiler"');
    expect(sanitizeHtml('<span class="evil">x</span>')).toBe('<span>x</span>');
  });

  it('elimina etiquetas desconocidas pero conserva el texto', () => {
    expect(sanitizeHtml('<marquee>texto</marquee>')).toBe('texto');
  });

  it('cierra las etiquetas abiertas y descarta cierres huérfanos', () => {
    expect(sanitizeHtml('<p>sin cerrar')).toBe('<p>sin cerrar</p>');
    expect(sanitizeHtml('texto</p></div>')).toBe('texto');
  });

  it('neutraliza entidades usadas para ofuscar', () => {
    const out = sanitizeHtml('<a href="&#106;avascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript');
  });

  it('rechaza el vector de comentario mal cerrado', () => {
    const out = sanitizeHtml('<!--><script>alert(1)</script>-->');
    expect(out).not.toContain('alert');
  });

  it('añade loading lazy a las imágenes y valida su src', () => {
    const out = sanitizeHtml('<img src="https://example.com/a.png" alt="a" onerror="alert(1)">');
    expect(out).toContain('loading="lazy"');
    expect(out).not.toContain('onerror');
    expect(sanitizeHtml('<img src="javascript:alert(1)">')).not.toContain('src');
  });

  it('limita la profundidad de anidamiento', () => {
    const deep = '<div>'.repeat(200) + 'x' + '</div>'.repeat(200);
    const out = sanitizeHtml(deep);
    const depth = (out.match(/<div>/g) ?? []).length;
    expect(depth).toBeLessThanOrEqual(24);
  });

  it('es idempotente: sanear dos veces no cambia el resultado', () => {
    const once = sanitizeHtml('<p>hola <strong>mundo</strong></p><script>x</script>');
    expect(sanitizeHtml(once)).toBe(once);
  });
});

describe('renderCommentBody', () => {
  it('escapa cualquier HTML del usuario', () => {
    const out = renderCommentBody('<script>alert(1)</script>');
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('convierte ||texto|| en spoiler', () => {
    const out = renderCommentBody('Cuidado ||muere el protagonista||');
    expect(out).toContain('class="spoiler"');
    expect(out).toContain('muere el protagonista');
  });

  it('convierte URLs en enlaces con rel seguro', () => {
    const out = renderCommentBody('Mira https://example.com/x');
    expect(out).toContain('rel="noopener noreferrer nofollow ugc"');
  });

  it('no crea enlaces desde texto con javascript:', () => {
    const out = renderCommentBody('javascript:alert(1)');
    expect(out).not.toContain('<a ');
  });

  it('separa párrafos y respeta los saltos de línea', () => {
    const out = renderCommentBody('uno\n\ndos\ntres');
    expect(out).toBe('<p>uno</p><p>dos<br />tres</p>');
  });
});

describe('htmlToText', () => {
  it('extrae texto plano y trunca sin cortar palabras', () => {
    const text = htmlToText('<p>Hola <strong>mundo</strong> entero</p>', 10);
    expect(text.length).toBeLessThanOrEqual(11);
    expect(text).not.toContain('<');
  });
});
