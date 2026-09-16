/**
 * JavaScript del panel de administración.
 * El editor enriquecido produce HTML *sugerido*; la autoridad es el sanitizador
 * del servidor, que vuelve a filtrarlo antes de guardarlo.
 */

import { initCoverUploader } from './cover-uploader';
import { initTypeFields } from './type-fields';
import { initLookup } from './lookup';

function toast(message: string, kind: 'ok' | 'error' | 'info' = 'info'): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  host.appendChild(el);
  window.setTimeout(() => el.remove(), 5000);
}

// ------------------------------------------------------- editor enriquecido --
function initEditor(): void {
  const rte = document.querySelector<HTMLElement>('[data-rte]');
  if (!rte) return;
  const surface = rte.querySelector<HTMLElement>('[data-rte-surface]');
  const input = rte.querySelector<HTMLTextAreaElement>('[data-rte-input]');
  const form = rte.closest('form');
  if (!surface || !input || !form) return;

  const sync = () => {
    input.value = surface.innerHTML;
  };

  rte.querySelectorAll<HTMLButtonElement>('[data-rte-cmd]').forEach((button) => {
    button.addEventListener('click', () => {
      const command = button.dataset.rteCmd!;
      const arg = button.dataset.rteArg;
      surface.focus();
      document.execCommand(command, false, arg);
      sync();
    });
  });

  rte.querySelector<HTMLButtonElement>('[data-rte-link]')?.addEventListener('click', () => {
    const url = window.prompt('URL del enlace (https://…)');
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) {
      toast('Sólo se permiten enlaces http o https.', 'error');
      return;
    }
    surface.focus();
    document.execCommand('createLink', false, url);
    sync();
  });

  rte.querySelector<HTMLButtonElement>('[data-rte-image]')?.addEventListener('click', () => {
    const url = window.prompt('URL de la imagen (o clave /media/…)');
    if (!url) return;
    surface.focus();
    document.execCommand('insertImage', false, url);
    sync();
  });

  rte.querySelector<HTMLButtonElement>('[data-rte-spoiler]')?.addEventListener('click', () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      toast('Selecciona primero el texto que quieres ocultar.', 'info');
      return;
    }
    const range = selection.getRangeAt(0);
    const span = document.createElement('span');
    span.className = 'spoiler';
    try {
      range.surroundContents(span);
    } catch {
      span.appendChild(range.extractContents());
      range.insertNode(span);
    }
    selection.removeAllRanges();
    sync();
  });

  surface.addEventListener('input', sync);
  surface.addEventListener('blur', sync);

  // Pegar siempre como texto plano: evita arrastrar estilos y markup de Word.
  surface.addEventListener('paste', (event) => {
    event.preventDefault();
    const text = event.clipboardData?.getData('text/plain') ?? '';
    document.execCommand('insertText', false, text);
    sync();
  });

  form.addEventListener('submit', sync);
  sync();
}

// -------------------------------------------------------- filas plataforma --
function initPlatformRows(): void {
  const host = document.querySelector<HTMLElement>('[data-platform-rows]');
  const template = document.querySelector<HTMLTemplateElement>('[data-platform-template]');
  const addButton = document.querySelector<HTMLButtonElement>('[data-platform-add]');
  if (!host || !template || !addButton) return;

  addButton.addEventListener('click', () => {
    const clone = template.content.cloneNode(true);
    host.appendChild(clone);
  });

  host.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-platform-remove]');
    if (!button) return;
    const rows = host.querySelectorAll('[data-platform-row]');
    if (rows.length <= 1) {
      button.closest('[data-platform-row]')?.querySelectorAll('input').forEach((i) => (i.value = ''));
      return;
    }
    button.closest('[data-platform-row]')?.remove();
  });
}

// --------------------------------------------------------- slug automático --
function initSlugHelper(): void {
  const title = document.querySelector<HTMLInputElement>('#f-titleEs');
  const slug = document.querySelector<HTMLInputElement>('#f-slug');
  if (!title || !slug) return;
  let touched = slug.value.length > 0;
  slug.addEventListener('input', () => {
    touched = true;
  });
  title.addEventListener('blur', async () => {
    if (touched || !title.value.trim()) return;
    try {
      const response = await fetch(`/admin/api/slug?title=${encodeURIComponent(title.value)}`, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      const payload = (await response.json()) as { ok: true; data: { slug: string } } | { ok: false };
      if (payload.ok) slug.value = payload.data.slug;
    } catch {
      /* el servidor generará el slug igualmente al guardar */
    }
  });
}

// --------------------------------------------------------- badge pendientes --
function initPendingBadge(): void {
  const link = document.querySelector<HTMLAnchorElement>('a[href="/admin/comentarios"]');
  if (!link) return;
  window.setInterval(async () => {
    try {
      const response = await fetch('/admin/api/stats/pendientes', {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      if (!response.ok) return;
      const payload = (await response.json()) as { ok: true; data: { pending: number } };
      const badge = link.querySelector('.badge');
      if (payload.data.pending > 0) {
        if (badge) badge.textContent = String(payload.data.pending);
        else {
          const el = document.createElement('span');
          el.className = 'badge badge--alert';
          el.textContent = String(payload.data.pending);
          link.appendChild(el);
        }
      } else badge?.remove();
    } catch {
      /* sondeo silencioso */
    }
  }, 60_000);
}


/**
 * La nota en estrellas.
 *
 * El control ya funciona sin esto: debajo hay un `input[type=range]` de verdad,
 * y el servidor pinta el relleno que corresponde al valor guardado. Lo que
 * añade el navegador es lo que se espera de unas estrellas — pulsar sobre una
 * para poner esa nota, y ver mientras pasas el ratón cuál vas a poner.
 *
 * En cuanto hay JavaScript, el puntero deja de hablar con el deslizador y pasa
 * a hablar con las estrellas: el deslizador reparte su anchura contando el
 * ancho del pulgar, así que su mapeo y el de las estrellas no coinciden del
 * todo y pulsar sobre la séptima podía dejar un 6,5. El deslizador se queda
 * para el teclado y los lectores de pantalla, que es donde hace falta.
 *
 * El relleno se cambia por `data-half`, no escribiendo en `style`: la CSP no
 * lleva `unsafe-inline` y las anchuras viven en la hoja de estilos, una regla
 * por valor.
 */
function initRatingStars(): void {
  const rating = document.querySelector<HTMLElement>('[data-rating]');
  if (!rating) return;

  const range = rating.querySelector<HTMLInputElement>('[data-rating-range]');
  const stars = rating.querySelector<HTMLElement>('[data-rating-stars]');
  const output = rating.querySelector<HTMLElement>('[data-rating-output]');
  const clear = rating.querySelector<HTMLButtonElement>('[data-rating-clear]');
  if (!range) return;

  const nota = (half: number): string => (half / 2).toFixed(1).replace('.', ',');

  /** Pinta un valor sin tocar el control: es lo que hace la previsualización. */
  const pintar = (half: number): void => {
    rating.dataset.half = String(half);
    if (output) output.textContent = nota(half);
  };

  const pintarValor = (): void => {
    const half = Number(range.value);
    pintar(half);
    // Un lector de pantalla anunciaría «15 de 20» sin esto.
    range.setAttribute('aria-valuetext', `${nota(half)} sobre 10`);
  };

  const fijar = (half: number): void => {
    const acotado = Math.max(0, Math.min(20, half));
    if (Number(range.value) === acotado) return;
    range.value = String(acotado);
    // El evento se dispara a mano: asignar `value` desde código no lo emite, y
    // sin él nadie más se entera del cambio.
    range.dispatchEvent(new Event('input', { bubbles: true }));
  };

  /**
   * Qué media estrella hay bajo el puntero.
   *
   * `ceil` y no `round`: la mitad izquierda de la primera estrella tiene que
   * dar 0,5, no 0. El cero se pone con el botón de al lado o con el teclado.
   */
  const halfEnPunto = (evento: PointerEvent | MouseEvent, caja: DOMRect): number => {
    if (caja.width <= 0) return Number(range.value);
    const proporcion = (evento.clientX - caja.left) / caja.width;
    return Math.max(1, Math.min(20, Math.ceil(proporcion * 20)));
  };

  range.addEventListener('input', pintarValor);
  range.addEventListener('change', pintarValor);
  pintarValor();

  if (stars) {
    // A partir de aquí manda el puntero sobre las estrellas. La clase invierte
    // en CSS quién recibe los eventos: hacerlo aquí y no en la hoja de estilos
    // dejaría el control muerto en cuanto fallara este script.
    rating.classList.add('rating--js');

    stars.addEventListener('pointermove', (evento) => {
      // Un dedo que arrastra no «previsualiza»: fija, y de eso se encarga el
      // pointerdown. La previsualización es cosa del ratón.
      if (evento.pointerType === 'touch') return;
      rating.classList.add('rating--preview');
      pintar(halfEnPunto(evento, stars.getBoundingClientRect()));
    });

    stars.addEventListener('pointerleave', () => {
      rating.classList.remove('rating--preview');
      pintarValor();
    });

    stars.addEventListener('pointerdown', (evento) => {
      evento.preventDefault();
      fijar(halfEnPunto(evento, stars.getBoundingClientRect()));
      rating.classList.remove('rating--preview');
      // El foco va al deslizador: quien acaba de pulsar una estrella puede
      // seguir afinando con las flechas sin buscar el control.
      range.focus();
    });
  }

  if (clear) {
    clear.hidden = false;
    clear.addEventListener('click', () => {
      fijar(0);
      range.focus();
    });
  }
}


function boot(): void {
  initEditor();
  initRatingStars();
  initCoverUploader(toast);
  initPlatformRows();
  initSlugHelper();
  initPendingBadge();
  initTypeFields();
  initLookup(toast);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

export {};
