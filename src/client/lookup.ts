/**
 * Buscar la ficha de una obra fuera y traérsela.
 *
 * Es lo que convierte escribir una reseña de veinticinco campos a mano en
 * elegir una candidata y corregir lo que haga falta. La consulta y la descarga
 * de la portada las hace **el servidor** —la CSP mantiene `connect-src 'self'`
 * y la dirección de quien escribe no llega a Open Library—; esto sólo pinta las
 * opciones y rellena los campos.
 *
 * Lo que llega de fuera es una sugerencia, nunca una decisión: no se aplica
 * nada hasta que se pulsa una candidata, y todos los campos siguen siendo
 * editables después.
 */
type Toast = (message: string, kind?: 'ok' | 'error' | 'info', timeout?: number) => void;

interface Candidata {
  title: string;
  authors: string | null;
  year: number | null;
  coverUrl: string | null;
  isbn13: string | null;
}

function csrfToken(form: HTMLFormElement | null): string {
  const input = (form ?? document).querySelector<HTMLInputElement>('input[name="_csrf"]');
  return input?.value ?? '';
}

async function pedir<T>(url: string, body: unknown, form: HTMLFormElement | null): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'X-CSRF-Token': csrfToken(form),
    },
    credentials: 'same-origin',
  });
  const payload = (await response.json()) as
    | { ok: true; data: T }
    | { ok: false; error: { message: string } };

  if (!response.ok || payload.ok === false) {
    throw new Error('error' in payload ? payload.error.message : 'No se ha podido consultar.');
  }
  return payload.data;
}

export function initLookup(toast: Toast): void {
  const caja = document.querySelector<HTMLElement>('[data-lookup]');
  if (!caja) return;

  const input = caja.querySelector<HTMLInputElement>('[data-lookup-input]');
  const boton = caja.querySelector<HTMLButtonElement>('[data-lookup-go]');
  const resultados = caja.querySelector<HTMLElement>('[data-lookup-results]');
  const form = caja.closest('form');
  if (!input || !boton || !resultados || !form) return;

  const campo = <T extends HTMLElement>(selector: string) => form.querySelector<T>(selector);

  /** Sólo se rellena lo que está vacío: lo escrito a mano manda. */
  const rellenar = (selector: string, valor: string | null) => {
    const destino = campo<HTMLInputElement>(selector);
    if (!destino || !valor) return;
    if (destino.value.trim().length) return;
    destino.value = valor;
  };

  const elegir = async (candidata: Candidata) => {
    rellenar('#f-titleEs', candidata.title);
    rellenar('#f-year', candidata.year ? String(candidata.year) : null);
    rellenar('#f-creator', candidata.authors);

    resultados.replaceChildren();
    input.value = '';

    if (!candidata.coverUrl) {
      toast('Ficha rellenada. Esa obra no tiene portada en el catálogo.', 'ok');
      return;
    }

    // La portada la baja el servidor y la guarda en R2: enlazar la de un
    // tercero dejaría la reseña a merced de que la cambien o la borren.
    toast('Trayendo la portada…', 'info', 3000);
    try {
      const portada = await pedir<{ key: string; url: string | null }>(
        '/admin/api/obras/portada',
        { url: candidata.coverUrl },
        form,
      );
      const clave = campo<HTMLInputElement>('[data-cover-key]');
      if (clave) clave.value = portada.key;

      // La vista previa se reutiliza si ya existe; si no, sustituye al hueco
      // vacío. Es el mismo trato que da la subida a mano.
      const previa = campo<HTMLImageElement>('[data-cover-preview]');
      const vacio = campo<HTMLElement>('[data-cover-preview-empty]');
      if (portada.url && previa) {
        previa.src = portada.url;
        previa.hidden = false;
      } else if (portada.url && vacio) {
        const img = document.createElement('img');
        img.src = portada.url;
        img.width = 200;
        img.height = 300;
        img.alt = 'Portada seleccionada';
        img.dataset.coverPreview = '1';
        vacio.replaceWith(img);
      }
      toast('Ficha rellenada y portada guardada. Revísalo antes de publicar.', 'ok');
    } catch (error) {
      toast(error instanceof Error ? error.message : 'No se ha podido traer la portada.', 'error');
    }
  };

  const pintar = (candidatas: Candidata[]) => {
    resultados.replaceChildren();
    if (!candidatas.length) {
      const vacio = document.createElement('p');
      vacio.className = 'lookup__empty';
      vacio.textContent = 'Nada con ese título. Escríbelo a mano y sigue.';
      resultados.appendChild(vacio);
      return;
    }

    const lista = document.createElement('ul');
    lista.className = 'lookup__list';
    for (const candidata of candidatas) {
      const item = document.createElement('li');
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'lookup__hit';

      const titulo = document.createElement('span');
      titulo.className = 'lookup__hit-title';
      titulo.textContent = candidata.title;

      const meta = document.createElement('span');
      meta.className = 'lookup__hit-meta';
      // Se compone con textContent y no con innerHTML: lo que llega de fuera
      // nunca se interpreta como marcado, aunque venga de un sitio conocido.
      meta.textContent = [candidata.authors, candidata.year ? String(candidata.year) : null]
        .filter(Boolean)
        .join(' · ');

      boton.append(titulo, meta);
      boton.addEventListener('click', () => void elegir(candidata));
      item.appendChild(boton);
      lista.appendChild(item);
    }
    resultados.appendChild(lista);
  };

  const buscar = async () => {
    const q = input.value.trim();
    if (q.length < 2) {
      toast('Escribe al menos dos letras.', 'error');
      return;
    }

    boton.disabled = true;
    try {
      const data = await pedir<{ results: Candidata[] }>('/admin/api/obras', { q }, form);
      pintar(data.results);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'No se ha podido buscar.', 'error');
    } finally {
      boton.disabled = false;
    }
  };

  boton.addEventListener('click', () => void buscar());

  // Sin esto, el Intro del buscador enviaría la reseña entera a medio escribir:
  // el campo vive dentro del formulario y el navegador hace lo que hace.
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    void buscar();
  });
}
