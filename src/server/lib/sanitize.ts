/**
 * Sanitizador HTML por allowlist, sin dependencias de DOM.
 *
 * Workers no expone DOM, por lo que DOMPurify no es viable. Este módulo tokeniza
 * el HTML con una máquina de estados y **reconstruye** la salida: nada del input
 * llega al output sin pasar por el escapador. Estrategia "deny by default":
 *   - etiqueta no permitida  -> se elimina la etiqueta (se conserva el texto)
 *   - etiqueta peligrosa     -> se elimina la etiqueta Y su contenido
 *   - atributo no permitido  -> se descarta
 *   - URL con esquema no permitido -> se descarta el atributo
 */

const VOID_TAGS = new Set(['br', 'hr', 'img']);

/** Etiquetas cuyo contenido se descarta por completo. */
const DANGEROUS_TAGS = new Set([
  'script', 'style', 'iframe', 'object', 'embed', 'template', 'noscript',
  'svg', 'math', 'form', 'input', 'button', 'select', 'textarea', 'link',
  'meta', 'base', 'frame', 'frameset', 'applet', 'audio', 'video', 'source',
]);

/** tag -> atributos permitidos */
const ALLOWED: Record<string, ReadonlySet<string>> = {
  p: new Set(),
  br: new Set(),
  hr: new Set(),
  strong: new Set(),
  b: new Set(),
  em: new Set(),
  i: new Set(),
  u: new Set(),
  s: new Set(),
  mark: new Set(),
  sup: new Set(),
  sub: new Set(),
  h2: new Set(['id']),
  h3: new Set(['id']),
  h4: new Set(['id']),
  ul: new Set(),
  ol: new Set(['start']),
  li: new Set(),
  blockquote: new Set(['cite']),
  a: new Set(['href', 'title']),
  img: new Set(['src', 'alt', 'width', 'height']),
  figure: new Set(),
  figcaption: new Set(),
  code: new Set(),
  pre: new Set(),
  span: new Set(['class']),
  div: new Set(['class']),
  table: new Set(),
  thead: new Set(),
  tbody: new Set(),
  tr: new Set(),
  th: new Set(['scope']),
  td: new Set(),
};

/** Únicas clases CSS que sobreviven (las usa el sistema de spoilers). */
const ALLOWED_CLASSES = new Set(['spoiler', 'spoiler-block', 'lead', 'note']);

const URL_ATTRS = new Set(['href', 'src', 'cite']);
const NUMERIC_ATTRS = new Set(['width', 'height', 'start']);

const MAX_DEPTH = 24;
const MAX_OUTPUT = 400_000;

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s: string): string {
  return escapeHtml(s);
}

// Los caracteres de control son justo lo que buscamos: son el vector clásico
// para ofuscar esquemas ("java\tscript:"), así que la regla se desactiva aquí.
// eslint-disable-next-line no-control-regex
const CONTROL_AND_INVISIBLE = /[\u0000-\u0020\u007f-\u00a0\u200b-\u200f\u2028\u2029\ufeff]+/g;

/**
 * Valida una URL de atributo. Devuelve la URL normalizada o null.
 * Sólo http/https/mailto absolutas, o rutas relativas que empiecen por "/".
 */
export function safeUrl(raw: string, opts: { allowRelative?: boolean } = {}): string | null {
  const allowRelative = opts.allowRelative !== false;
  // Elimina controles y espacios usados para ofuscar esquemas ("java\tscript:").
  const value = raw.replace(CONTROL_AND_INVISIBLE, '').trim();
  if (!value) return null;
  // Rutas relativas seguras (no "//host" ni "/\host", que son protocol-relative).
  if (allowRelative && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')) {
    return raw.trim();
  }
  if (allowRelative && (value.startsWith('#') || value.startsWith('?'))) return raw.trim();
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(value);
  if (!m) return null;
  const scheme = m[1]!.toLowerCase();
  if (scheme !== 'http' && scheme !== 'https' && scheme !== 'mailto') return null;
  try {
    const u = new URL(raw.trim());
    return u.toString();
  } catch {
    return null;
  }
}

interface Attr { name: string; value: string }

interface TagToken {
  kind: 'open' | 'close';
  name: string;
  attrs: Attr[];
  selfClosing: boolean;
}

/** Parsea el contenido interior de `<...>` en nombre + atributos. */
function parseTag(src: string): TagToken | null {
  let i = 0;
  const kind: 'open' | 'close' = src[0] === '/' ? 'close' : 'open';
  if (kind === 'close') i = 1;
  const nameStart = i;
  while (i < src.length && /[a-zA-Z0-9:-]/.test(src[i]!)) i++;
  const name = src.slice(nameStart, i).toLowerCase();
  if (!name) return null;

  const attrs: Attr[] = [];
  let selfClosing = false;

  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i]!)) i++;
    if (i >= src.length) break;
    if (src[i] === '/') { selfClosing = true; i++; continue; }
    const aStart = i;
    while (i < src.length && !/[\s=/]/.test(src[i]!)) i++;
    const aName = src.slice(aStart, i).toLowerCase();
    if (!aName) { i++; continue; }
    while (i < src.length && /\s/.test(src[i]!)) i++;
    let aValue = '';
    if (src[i] === '=') {
      i++;
      while (i < src.length && /\s/.test(src[i]!)) i++;
      const q = src[i];
      if (q === '"' || q === "'") {
        i++;
        const vStart = i;
        while (i < src.length && src[i] !== q) i++;
        aValue = src.slice(vStart, i);
        i++;
      } else {
        const vStart = i;
        while (i < src.length && !/\s/.test(src[i]!)) i++;
        aValue = src.slice(vStart, i);
      }
    }
    attrs.push({ name: aName, value: decodeBasicEntities(aValue) });
  }
  return { kind, name, attrs, selfClosing };
}

/** Decodifica sólo las entidades básicas: suficiente para detectar ofuscación. */
function decodeBasicEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);?/g, (whole, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (Number.isFinite(code) && code > 0 && code < 0x110000) {
        try { return String.fromCodePoint(code); } catch { return ''; }
      }
      return '';
    }
    const map: Record<string, string> = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
    };
    return map[body.toLowerCase()] ?? whole;
  });
}

function filterAttrs(tag: string, attrs: Attr[]): Attr[] {
  const allowed = ALLOWED[tag]!;
  const out: Attr[] = [];
  for (const { name, value } of attrs) {
    // Nunca: on*, style, srcset, formaction, xlink:*, data-* arbitrarios.
    if (name.startsWith('on') || name === 'style' || name.includes(':')) continue;
    if (!allowed.has(name)) continue;

    if (URL_ATTRS.has(name)) {
      const url = safeUrl(value);
      if (!url) continue;
      out.push({ name, value: url });
      continue;
    }
    if (NUMERIC_ATTRS.has(name)) {
      const n = parseInt(value, 10);
      if (!Number.isFinite(n) || n < 0 || n > 20000) continue;
      out.push({ name, value: String(n) });
      continue;
    }
    if (name === 'class') {
      const kept = value.split(/\s+/).filter((c) => ALLOWED_CLASSES.has(c));
      if (!kept.length) continue;
      out.push({ name, value: kept.join(' ') });
      continue;
    }
    if (name === 'id') {
      if (!/^[a-zA-Z][\w-]{0,63}$/.test(value)) continue;
      out.push({ name, value });
      continue;
    }
    if (name === 'scope') {
      if (value !== 'row' && value !== 'col') continue;
      out.push({ name, value });
      continue;
    }
    out.push({ name, value: value.slice(0, 1000) });
  }
  return out;
}

function renderOpen(tag: string, attrs: Attr[]): string {
  let s = '<' + tag;
  for (const a of attrs) s += ` ${a.name}="${escapeAttr(a.value)}"`;
  if (tag === 'a') {
    // Enlaces externos: sin referrer y sin acceso a window.opener.
    const href = attrs.find((a) => a.name === 'href')?.value ?? '';
    if (/^https?:/i.test(href)) s += ' rel="noopener noreferrer nofollow" target="_blank"';
  }
  if (tag === 'img') s += ' loading="lazy" decoding="async"';
  return s + (VOID_TAGS.has(tag) ? ' />' : '>');
}

/**
 * Sanea HTML enriquecido procedente del editor del administrador.
 */
export function sanitizeHtml(input: string): string {
  if (!input) return '';
  const src = input.length > MAX_OUTPUT ? input.slice(0, MAX_OUTPUT) : input;
  const out: string[] = [];
  const stack: string[] = [];
  let i = 0;

  const flushText = (text: string) => {
    if (!text) return;
    out.push(escapeHtml(decodeBasicEntities(text)));
  };

  while (i < src.length) {
    const lt = src.indexOf('<', i);
    if (lt === -1) { flushText(src.slice(i)); break; }
    flushText(src.slice(i, lt));

    // Comentarios y declaraciones: se descartan enteros.
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      i = end === -1 ? src.length : end + 3;
      continue;
    }
    if (src.startsWith('<!', lt) || src.startsWith('<?', lt)) {
      const end = src.indexOf('>', lt);
      i = end === -1 ? src.length : end + 1;
      continue;
    }

    const gt = src.indexOf('>', lt);
    if (gt === -1) { flushText(src.slice(lt)); break; }

    const token = parseTag(src.slice(lt + 1, gt));
    i = gt + 1;
    if (!token) continue;

    const { kind, name, attrs, selfClosing } = token;

    if (DANGEROUS_TAGS.has(name)) {
      if (kind === 'open' && !selfClosing) {
        // Descarta también el contenido hasta el cierre correspondiente.
        const closeRe = new RegExp(`</\\s*${name}\\s*>`, 'i');
        const rest = src.slice(i);
        const m = closeRe.exec(rest);
        i = m ? i + m.index + m[0].length : src.length;
      }
      continue;
    }

    if (!(name in ALLOWED)) continue; // etiqueta desconocida: se elimina, texto se conserva

    if (kind === 'close') {
      const idx = stack.lastIndexOf(name);
      if (idx === -1) continue; // cierre huérfano
      while (stack.length > idx) out.push(`</${stack.pop()}>`);
      continue;
    }

    if (VOID_TAGS.has(name)) {
      out.push(renderOpen(name, filterAttrs(name, attrs)));
      continue;
    }
    if (stack.length >= MAX_DEPTH) continue;
    out.push(renderOpen(name, filterAttrs(name, attrs)));
    stack.push(name);
  }

  while (stack.length) out.push(`</${stack.pop()}>`);
  const result = out.join('');
  return result.length > MAX_OUTPUT ? result.slice(0, MAX_OUTPUT) : result;
}

/** Texto plano legible a partir de HTML saneado (extractos, meta description). */
export function htmlToText(html: string, maxLen = 300): string {
  const text = html
    .replace(/<\/(p|div|li|h2|h3|h4|blockquote)>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const decoded = decodeBasicEntities(text);
  if (decoded.length <= maxLen) return decoded;
  return decoded.slice(0, maxLen - 1).replace(/\s+\S*$/, '') + '…';
}

/**
 * Render de comentarios: entrada **texto plano**, salida HTML generado por
 * nosotros. Nunca se interpreta HTML del usuario.
 *   - saltos de línea -> <br> / <p>
 *   - ||texto|| -> spoiler
 *   - URLs http(s) -> enlaces con rel seguro
 */
export function renderCommentBody(body: string): string {
  const paragraphs = escapeHtml(body)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(0, 40);

  const linkify = (chunk: string) =>
    chunk.replace(/(https?:\/\/[^\s<]{4,300})/g, (url) => {
      const clean = url.replace(/[.,;:)\]]+$/, '');
      const trailing = url.slice(clean.length);
      // `clean` viene ya escapado; safeUrl trabaja sobre el texto decodificado.
      const checked = safeUrl(decodeBasicEntities(clean), { allowRelative: false });
      if (!checked) return url;
      const label = clean.length > 60 ? clean.slice(0, 57) + '…' : clean;
      return `<a href="${escapeAttr(checked)}" rel="noopener noreferrer nofollow ugc" target="_blank">${label}</a>${trailing}`;
    });

  const spoilerify = (chunk: string) =>
    chunk.replace(
      /\|\|([\s\S]{1,2000}?)\|\|/g,
      '<span class="spoiler" data-spoiler tabindex="0" role="button" aria-expanded="false">$1</span>',
    );

  return paragraphs
    .map((p) => `<p>${spoilerify(linkify(p.replace(/\n/g, '<br />')))}</p>`)
    .join('');
}
