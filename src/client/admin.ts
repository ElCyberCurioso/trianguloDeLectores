/**
 * JavaScript del panel de administración.
 * El editor enriquecido produce HTML *sugerido*; la autoridad es el sanitizador
 * del servidor, que vuelve a filtrarlo antes de guardarlo.
 */

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

function csrfToken(form: HTMLFormElement | null): string {
  const input = (form ?? document).querySelector<HTMLInputElement>('input[name="_csrf"]');
  return input?.value ?? '';
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

// ------------------------------------------------------------ subida portada --
function initCoverUploader(): void {
  const uploader = document.querySelector<HTMLElement>('[data-cover-uploader]');
  if (!uploader) return;
  const input = uploader.querySelector<HTMLInputElement>('[data-cover-input]');
  const keyField = uploader.querySelector<HTMLInputElement>('[data-cover-key]');
  // Mutables: la primera subida sustituye el hueco vacío por un `<img>`, y a
  // partir de ahí las siguientes reutilizan ese mismo elemento.
  let preview = uploader.querySelector<HTMLImageElement>('[data-cover-preview]');
  let empty = uploader.querySelector<HTMLElement>('[data-cover-preview-empty]');
  const removeButton = uploader.querySelector<HTMLButtonElement>('[data-cover-remove]');
  const form = uploader.closest('form');
  if (!input || !keyField) return;

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast('La imagen supera los 5 MB.', 'error');
      input.value = '';
      return;
    }

    const body = new FormData();
    body.append('file', file);
    body.append('_csrf', csrfToken(form));

    try {
      const response = await fetch('/admin/api/media/portada', {
        method: 'POST',
        body,
        headers: { Accept: 'application/json', 'X-CSRF-Token': csrfToken(form) },
        credentials: 'same-origin',
      });
      const payload = (await response.json()) as
        | { ok: true; data: { key: string; url: string | null } }
        | { ok: false; error: { message: string } };

      if (!response.ok || payload.ok === false) {
        toast('error' in payload ? payload.error.message : 'No se ha podido subir la imagen.', 'error');
        return;
      }

      keyField.value = payload.data.key;
      // La vista previa sale de la URL pública que devuelve el servidor, no de
      // `URL.createObjectURL(file)`: la CSP declara `img-src 'self' data:` más
      // el dominio de medios, y un `blob:` lo bloquea el navegador.
      const previewUrl = payload.data.url;
      if (previewUrl) {
        if (preview) {
          preview.src = previewUrl;
          preview.hidden = false;
        } else if (empty) {
          const img = document.createElement('img');
          img.src = previewUrl;
          img.width = 200;
          img.height = 300;
          img.alt = 'Portada seleccionada';
          img.dataset.coverPreview = '1';
          empty.replaceWith(img);
          preview = img;
          empty = null;
        }
      }
      toast('Portada subida. Recuerda guardar la reseña.', 'ok');
    } catch {
      toast('Error de red al subir la imagen.', 'error');
    } finally {
      input.value = '';
    }
  });

  removeButton?.addEventListener('click', () => {
    keyField.value = '';
    if (preview) preview.hidden = true;
    toast('Portada quitada. Guarda para aplicar el cambio.', 'info');
  });
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

function boot(): void {
  initEditor();
  initCoverUploader();
  initPlatformRows();
  initSlugHelper();
  initPendingBadge();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

export {};
