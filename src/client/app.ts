/**
 * JavaScript público. Todo el sitio funciona sin él (SSR + formularios
 * nativos); este fichero sólo mejora la experiencia.
 * Sin dependencias, sin eval, compatible con CSP estricta.
 */

type ToastKind = 'ok' | 'error' | 'info';

// ------------------------------------------------------------------ toasts --
function toast(message: string, kind: ToastKind = 'info', timeout = 5000): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'toast__close';
  close.setAttribute('aria-label', 'Cerrar aviso');
  close.textContent = '×';
  close.addEventListener('click', () => el.remove());
  el.appendChild(close);
  host.appendChild(el);
  window.setTimeout(() => el.remove(), timeout);
}

// ------------------------------------------------------------------- tema --
function initTheme(): void {
  const root = document.documentElement;
  const button = document.querySelector<HTMLButtonElement>('[data-theme-toggle]');
  if (!button) return;

  // Sin marca explícita el tema es el oscuro, que es el del sitio.
  const current = (): 'light' | 'dark' => (root.dataset.theme === 'light' ? 'light' : 'dark');

  const sync = () => button.setAttribute('aria-pressed', current() === 'light' ? 'true' : 'false');
  sync();

  button.addEventListener('click', () => {
    const next = current() === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    try {
      localStorage.setItem('tdl-theme', next);
    } catch {
      /* modo privado: el tema simplemente no persiste */
    }
    sync();
  });
}

// --------------------------------------------------------------- spoilers --
function initSpoilers(scope: ParentNode = document): void {
  scope.querySelectorAll<HTMLElement>('.spoiler:not([data-ready])').forEach((el) => {
    el.dataset.ready = '1';
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    if (!el.hasAttribute('tabindex')) el.tabIndex = 0;
    el.setAttribute('aria-expanded', 'false');
    el.setAttribute('aria-label', 'Contenido con spoiler, pulsa para mostrar');

    const reveal = () => {
      el.classList.add('is-revealed');
      el.setAttribute('aria-expanded', 'true');
      el.removeAttribute('aria-label');
    };
    el.addEventListener('click', reveal);
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        reveal();
      }
    });
  });
}

// ------------------------------------------------------------------ modal --
interface ModalState {
  dialog: HTMLDialogElement;
  content: HTMLElement;
  lastFocused: Element | null;
  previousUrl: string;
}

let modal: ModalState | null = null;

function initModal(): void {
  const dialog = document.querySelector<HTMLDialogElement>('[data-review-modal]');
  const content = document.getElementById('review-modal-content');
  if (!dialog || !content || typeof dialog.showModal !== 'function') return;

  modal = { dialog, content, lastFocused: null, previousUrl: location.href };

  dialog.querySelector('[data-modal-close]')?.addEventListener('click', () => dialog.close());

  // Clic en el backdrop (fuera del contenido) cierra.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  // <dialog> ya gestiona Escape y la trampa de foco de forma nativa.
  dialog.addEventListener('close', () => {
    if (modal && location.href !== modal.previousUrl) history.pushState({}, '', modal.previousUrl);
    (modal?.lastFocused as HTMLElement | null)?.focus?.();
    content.innerHTML = '';
  });

  document.addEventListener('click', (event) => {
    const target = event.target as HTMLElement | null;
    const link = target?.closest<HTMLAnchorElement>('[data-review-open]');
    if (!link) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    void openReview(link.getAttribute('href') ?? '/');
  });

  window.addEventListener('popstate', () => {
    if (dialog.open) dialog.close();
  });
}

async function openReview(href: string): Promise<void> {
  if (!modal) return;
  modal.lastFocused = document.activeElement;
  modal.previousUrl = location.href;
  modal.content.innerHTML = '<div class="modal__loading"><div class="skeleton skeleton--line"></div><div class="skeleton skeleton--line"></div><div class="skeleton skeleton--line skeleton--short"></div></div>';
  modal.dialog.showModal();

  try {
    const url = new URL(href, location.origin);
    url.searchParams.set('parcial', '1');
    const response = await fetch(url.toString(), {
      headers: { Accept: 'text/html' },
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // El fragmento lo genera nuestro propio servidor y ya está saneado.
    modal.content.innerHTML = await response.text();
    history.pushState({}, '', href);
    initSpoilers(modal.content);
    initCommentForms(modal.content);
    initReportForms(modal.content);
    loadTurnstile(modal.content);
    modal.content.focus();
  } catch {
    modal.content.innerHTML = '<p class="notice">No hemos podido cargar la reseña. <a href="' + escapeAttr(href) + '">Ábrela en su página</a>.</p>';
  }
}

function escapeAttr(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

// -------------------------------------------------------------- comentarios --
function initCommentForms(scope: ParentNode = document): void {
  scope.querySelectorAll<HTMLFormElement>('[data-comment-form]:not([data-ready])').forEach((form) => {
    form.dataset.ready = '1';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          body: new FormData(form),
          headers: { Accept: 'application/json', 'X-Requested-With': 'fetch' },
          credentials: 'same-origin',
        });
        const payload = (await response.json()) as
          | { ok: true; data: { pending: boolean; message: string } }
          | { ok: false; error: { message: string } };

        if (!response.ok || payload.ok === false) {
          toast('error' in payload ? payload.error.message : 'No se ha podido publicar el comentario.', 'error');
          return;
        }
        toast(payload.data.message, 'ok');
        form.reset();
        resetTurnstile(form);
        if (!payload.data.pending) window.setTimeout(() => location.reload(), 900);
      } catch {
        toast('Error de red. Inténtalo de nuevo.', 'error');
      } finally {
        if (button) button.disabled = false;
      }
    });
  });

  scope.querySelectorAll<HTMLButtonElement>('[data-reply-toggle]:not([data-ready])').forEach((button) => {
    button.dataset.ready = '1';
    button.addEventListener('click', () => {
      // El hueco de respuesta vive en la misma caja que el botón: buscarlo por
      // proximidad evita depender de escapar identificadores en un selector.
      const slot = button.closest('.comment__box')?.querySelector<HTMLElement>('[data-reply-slot]');
      if (!slot) return;
      const isHidden = slot.hasAttribute('hidden');
      if (isHidden) slot.removeAttribute('hidden');
      else slot.setAttribute('hidden', '');
      button.setAttribute('aria-expanded', String(isHidden));
      if (isHidden) slot.querySelector<HTMLTextAreaElement>('textarea')?.focus();
    });
  });
}

function initReportForms(scope: ParentNode = document): void {
  scope.querySelectorAll<HTMLFormElement>('[data-report-form]:not([data-ready])').forEach((form) => {
    form.dataset.ready = '1';
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const button = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          body: new FormData(form),
          headers: { Accept: 'application/json', 'X-Requested-With': 'fetch' },
          credentials: 'same-origin',
        });
        const payload = (await response.json()) as
          | { ok: true; data: { message: string } }
          | { ok: false; error: { message: string } };
        if (!response.ok || payload.ok === false) {
          toast('error' in payload ? payload.error.message : 'No se ha podido enviar el reporte.', 'error');
          return;
        }
        toast(payload.data.message, 'ok');
        form.closest('details')?.removeAttribute('open');
        form.reset();
      } catch {
        toast('Error de red. Inténtalo de nuevo.', 'error');
      } finally {
        if (button) button.disabled = false;
      }
    });
  });
}

// ---------------------------------------------------------------- filtros --
function initFilters(): void {
  const form = document.querySelector<HTMLFormElement>('[data-filters]');
  if (!form) return;
  form.querySelectorAll<HTMLSelectElement>('[data-autosubmit]').forEach((select) => {
    select.addEventListener('change', () => form.submit());
  });
}

// ------------------------------------------------------- menú de usuario --
/**
 * El menú es un <details>, así que ya funciona sin esto. Aquí sólo se añade lo
 * que un desplegable debe hacer y el elemento nativo no trae: cerrarse al pulsar
 * fuera y con Escape, devolviendo el foco al botón.
 */
function initUserMenu(): void {
  const menu = document.querySelector<HTMLDetailsElement>('[data-user-menu]');
  if (!menu) return;

  document.addEventListener('click', (event) => {
    if (menu.open && !menu.contains(event.target as Node)) menu.open = false;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector<HTMLElement>('summary')?.focus();
    }
  });
}

// ------------------------------------------------------------ confirmación --
function initConfirms(): void {
  document.addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement;
    const message = form.getAttribute?.('data-confirm');
    if (message && !window.confirm(message)) event.preventDefault();
  });
}

// --------------------------------------------------------------- turnstile --
let turnstileLoading = false;

/**
 * Cuánto se espera al script de Cloudflare antes de dar por hecho que no viene.
 * Con una conexión mala tarda, pero si a los ocho segundos no está cargado, casi
 * siempre es que algo lo está bloqueando.
 */
const TURNSTILE_TIMEOUT_MS = 8000;

/**
 * Destapa el aviso que ya está en el hueco del widget.
 *
 * Sin esto, un script bloqueado se traduce en un recuadro que no aparece, un
 * formulario que se envía sin token y un error del servidor que no explica nada.
 * Quien lo sufre no tiene forma de saber que la culpa es de su bloqueador.
 */
function reportTurnstileFailure(): void {
  document.querySelectorAll<HTMLElement>('[data-turnstile-fallback]').forEach((el) => {
    el.hidden = false;
  });
}

function loadTurnstile(scope: ParentNode = document): void {
  if (!scope.querySelector('.cf-turnstile')) return;
  if (turnstileLoading || document.querySelector('script[data-turnstile]')) {
    window.turnstile?.render?.('.cf-turnstile');
    return;
  }
  turnstileLoading = true;
  const script = document.createElement('script');
  // `strict-dynamic` permite que un script con nonce cargue este otro.
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
  script.async = true;
  script.defer = true;
  script.dataset.turnstile = '1';
  // Un bloqueador de red suele disparar `error`, pero uno que devuelve una
  // respuesta vacía carga «bien» y deja `window.turnstile` sin definir: de ahí
  // que haga falta además el plazo.
  script.addEventListener('error', reportTurnstileFailure);
  document.head.appendChild(script);

  window.setTimeout(() => {
    if (!window.turnstile) reportTurnstileFailure();
  }, TURNSTILE_TIMEOUT_MS);
}

function resetTurnstile(form: HTMLFormElement): void {
  const widget = form.querySelector('.cf-turnstile');
  if (widget && window.turnstile?.reset) window.turnstile.reset(widget as HTMLElement);
}

declare global {
  interface Window {
    turnstile?: {
      render?: (selector: string | HTMLElement) => void;
      reset?: (widget?: HTMLElement) => void;
    };
  }
}

// ---------------------------------------------------------- avisos por URL --
function initFlashFromQuery(): void {
  const params = new URLSearchParams(location.search);
  const comentario = params.get('comentario');
  if (comentario === 'pendiente') toast('Tu comentario se publicará tras revisarse.', 'ok');
  if (comentario === 'publicado') toast('Comentario publicado.', 'ok');
  if (params.get('reporte') === 'recibido') toast('Gracias, hemos recibido tu reporte.', 'ok');
  if (params.get('error') === 'validacion') toast('Revisa el formulario antes de enviarlo.', 'error');
}

function boot(): void {
  initTheme();
  initSpoilers();
  initModal();
  initCommentForms();
  initReportForms();
  initFilters();
  initUserMenu();
  initConfirms();
  initFlashFromQuery();
  loadTurnstile();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

export {};
