/**
 * La subida de portadas, compartida por el panel y el sitio público.
 *
 * Vivía sólo en el bundle del panel, y el alta de pendientes se mudó a la
 * página pública, que no lo carga: el botón «Subir imagen» abría el selector y
 * ahí se acababa todo, sin aviso ninguno. Es el mismo formulario en los dos
 * sitios, así que es el mismo código en los dos sitios.
 *
 * El endpoint sigue siendo el del panel (`/admin/api/media/portada`, detrás de
 * `requireAdmin` y `requireCsrf`): que el formulario esté en el sitio público
 * no lo hace público, y el dominio es el mismo, así que la cookie de sesión y
 * la comprobación de origen valen igual.
 *
 * `toast` se recibe en vez de importarse: el panel y el sitio público tienen
 * cada uno el suyo —el público lleva botón de cerrar— y este módulo no tiene
 * por qué elegir.
 */
type Toast = (message: string, kind?: 'ok' | 'error' | 'info') => void;

function csrfToken(form: HTMLFormElement | null): string {
  const input = (form ?? document).querySelector<HTMLInputElement>('input[name="_csrf"]');
  return input?.value ?? '';
}

export function initCoverUploader(toast: Toast): void {
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
      // «Guarda los cambios» y no «guarda la reseña»: el mismo aviso sale en la
      // ficha de un pendiente, que no es una reseña.
      toast('Portada subida. Recuerda guardar los cambios.', 'ok');
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
