/**
 * JavaScript de la biblioteca privada.
 *
 * Tres islas independientes que conviven en un bundle: la subida de PDF, el
 * lector y el editor de la biblioteca física. Cada una se activa sólo si
 * encuentra su marcado, así que ninguna página paga por las demás.
 *
 * Sobre los estilos: la CSP no lleva `unsafe-inline`, y el proyecto prohíbe
 * `style=` en el marcado del servidor. Aquí se posicionan páginas y subrayados
 * escribiendo en `element.style` desde JavaScript, que es CSSOM y no está
 * sujeto a esa restricción — un visor de PDF no puede colocar una capa de texto
 * con clases. Del servidor no sale ni un `style=`.
 */

// ------------------------------------------------------------------ base --
function toast(message: string, kind: 'ok' | 'error' | 'info' = 'info'): void {
  let host = document.getElementById('toasts');
  if (!host) {
    host = document.createElement('div');
    host.id = 'toasts';
    host.className = 'toasts';
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.textContent = message;
  host.appendChild(el);
  window.setTimeout(() => el.remove(), 5000);
}

function csrf(): string {
  const field = document.querySelector<HTMLInputElement>('input[name="_csrf"], [data-csrf]');
  if (!field) return '';
  return field.value || field.dataset.csrf || '';
}

async function api<T>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf(),
      ...(options.headers ?? {}),
    },
  });
  const payload = (await response.json()) as { ok: boolean; data?: T; error?: { message: string } };
  if (!response.ok || !payload.ok) throw new Error(payload.error?.message ?? 'Error inesperado');
  return payload.data as T;
}

/** Confirmación antes de cualquier borrado. */
function initConfirmForms(): void {
  document.querySelectorAll<HTMLFormElement>('form[data-confirm]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      if (!window.confirm(form.dataset.confirm ?? '¿Seguro?')) event.preventDefault();
    });
  });
}

/** Las barras de avance llevan su porcentaje en un `data-*`, no en `style=`. */
function initProgressBars(): void {
  document.querySelectorAll<HTMLElement>('[data-progress]').forEach((bar) => {
    const percent = Number(bar.dataset.progress ?? '0');
    bar.style.setProperty('--progress', `${Math.max(0, Math.min(100, percent))}%`);
  });
}

// -------------------------------------------------------- subida de PDF --
function initUpload(): void {
  const form = document.querySelector<HTMLFormElement>('[data-upload-form]');
  if (!form) return;

  const input = form.querySelector<HTMLInputElement>('[data-upload-input]');
  const titleField = form.querySelector<HTMLInputElement>('[data-upload-title]');
  const authorField = form.querySelector<HTMLInputElement>('[data-upload-author]');
  const status = form.querySelector<HTMLElement>('[data-upload-status]');
  const bar = form.querySelector<HTMLElement>('[data-upload-bar]');
  const text = form.querySelector<HTMLElement>('[data-upload-text]');
  if (!input || !titleField) return;

  // El nombre del fichero es una primera propuesta de título: casi siempre
  // sirve y ahorra escribirlo.
  const nameLabel = form.querySelector<HTMLElement>('[data-upload-name]');

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    // El campo va oculto tras una etiqueta propia: sin esto no habría forma de
    // saber qué fichero se ha elegido.
    if (nameLabel) nameLabel.textContent = file.name;
    if (!titleField.value.trim()) {
      titleField.value = file.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' ').trim();
    }
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const file = input.files?.[0];
    if (!file) return;

    status?.classList.add('upload__status--active');
    if (text) text.textContent = 'Subiendo…';

    /**
     * XMLHttpRequest y no `fetch`: es la única forma de saber cuánto se lleva
     * subido. Con 50 MB por delante, una barra que avanza no es un adorno.
     */
    const query = new URLSearchParams({ title: titleField.value, author: authorField?.value ?? '' });
    const request = new XMLHttpRequest();
    request.open('POST', `/api/documentos?${query.toString()}`);
    request.setRequestHeader('Content-Type', 'application/pdf');
    request.setRequestHeader('X-CSRF-Token', csrf());
    request.setRequestHeader('Accept', 'application/json');

    request.upload.addEventListener('progress', (progressEvent) => {
      if (!progressEvent.lengthComputable) return;
      const percent = Math.round((progressEvent.loaded / progressEvent.total) * 100);
      bar?.style.setProperty('--progress', `${percent}%`);
      if (text) text.textContent = `Subiendo… ${percent}%`;
    });

    request.addEventListener('load', () => {
      if (request.status >= 200 && request.status < 300) {
        if (text) text.textContent = 'Generando la portada…';
        /*
         * La portada por omisión es la primera página, y este es el mejor
         * momento para sacarla: el fichero ya está en el navegador, así que no
         * hay que volver a descargarlo. Si falla, el libro queda igualmente
         * subido y con marcador gris — se puede poner una a mano después.
         */
        void (async () => {
          try {
            const payload = JSON.parse(request.responseText) as { data: { id: string } };
            const blob = await renderFirstPage({ data: await file.arrayBuffer() });
            if (blob) await putCover(payload.data.id, blob);
          } catch {
            /* sin portada automática: no es motivo para no continuar */
          } finally {
            window.location.reload();
          }
        })();
        return;
      }
      let message = 'No se ha podido subir el PDF.';
      try {
        const payload = JSON.parse(request.responseText) as { error?: { message: string } };
        if (payload.error?.message) message = payload.error.message;
      } catch {
        /* respuesta sin JSON: se queda el mensaje genérico */
      }
      status?.classList.remove('upload__status--active');
      if (text) text.textContent = '';
      toast(message, 'error');
    });

    request.addEventListener('error', () => {
      status?.classList.remove('upload__status--active');
      toast('Error de red al subir el PDF.', 'error');
    });

    request.send(file);
  });
}

/**
 * Cambiar la portada de un documento desde la estantería: subiendo una imagen o
 * indicando una dirección. En los dos casos acaba guardada en R2 — la URL sólo
 * viaja hasta el servidor, que descarga la imagen y se queda con ella.
 */
function initCoverActions(): void {
  document.querySelectorAll<HTMLElement>('[data-cover-actions]').forEach((group) => {
    const documentId = group.dataset.documentId!;

    group.querySelector<HTMLInputElement>('[data-cover-file]')?.addEventListener('change', async (event) => {
      const input = event.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      try {
        await putCover(documentId, file);
        window.location.reload();
      } catch {
        toast('No se ha podido guardar la portada.', 'error');
      } finally {
        input.value = '';
      }
    });

    group.querySelector<HTMLButtonElement>('[data-cover-url]')?.addEventListener('click', async () => {
      const url = window.prompt('Dirección de la imagen (https://…)');
      if (!url) return;
      try {
        await api(`/api/documentos/${documentId}/portada`, {
          method: 'PUT',
          body: JSON.stringify({ url: url.trim() }),
        });
        window.location.reload();
      } catch (error) {
        toast(error instanceof Error ? error.message : 'No se ha podido traer la imagen.', 'error');
      }
    });
  });
}

// ------------------------------------------------------------- el lector --
interface PdfPageViewport { width: number; height: number; scale: number }
interface PdfPage {
  getViewport(options: { scale: number }): PdfPageViewport;
  render(options: { canvasContext: CanvasRenderingContext2D; viewport: PdfPageViewport }): { promise: Promise<void> };
  streamTextContent(options?: Record<string, unknown>): unknown;
}
interface PdfDocument { numPages: number; getPage(page: number): Promise<PdfPage> }
interface PdfJsModule {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(options: Record<string, unknown>): { promise: Promise<PdfDocument> };
  TextLayer: new (options: { textContentSource: unknown; container: HTMLElement; viewport: PdfPageViewport }) => {
    render(): Promise<void>;
  };
}

interface Annotation {
  id: string;
  kind: 'HIGHLIGHT' | 'NOTE';
  page: number;
  rects: { x: number; y: number; w: number; h: number }[];
  quote: string | null;
  body: string | null;
  color: 'YELLOW' | 'RED' | 'GREEN' | 'BLUE';
}

/**
 * Carga pdf.js una sola vez.
 *
 * Son 1,6 MB entre el visor y su worker, así que no entra en el bundle: se pide
 * a mano cuando hace falta. El especificador es una variable para que el
 * empaquetador lo deje como está en vez de incrustarlo.
 */
let pdfjsPromise: Promise<PdfJsModule> | null = null;

function loadPdfJs(): Promise<PdfJsModule> {
  if (!pdfjsPromise) {
    const modulePath = '/assets/pdf/pdf.min.mjs';
    pdfjsPromise = import(/* @vite-ignore */ modulePath).then((module_) => {
      const pdfjs = module_ as unknown as PdfJsModule;
      pdfjs.GlobalWorkerOptions.workerSrc = '/assets/pdf/pdf.worker.min.mjs';
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

const PDF_SOURCE_OPTIONS = {
  cMapUrl: '/assets/pdf/cmaps/',
  cMapPacked: true,
  standardFontDataUrl: '/assets/pdf/standard_fonts/',
  wasmUrl: '/assets/pdf/wasm/',
};

/** Ancho de la portada generada. Suficiente para la lista y para una retina. */
const COVER_WIDTH = 400;

/**
 * Pinta la primera página de un PDF y la devuelve como JPEG.
 *
 * La portada por omisión sale de aquí. Tiene que hacerse en el navegador: el
 * Worker no puede rasterizar un PDF sin traerse una librería entera, y encima
 * gastaría CPU de la petición. Aquí el fichero ya está delante.
 */
async function renderFirstPage(source: { url: string } | { data: ArrayBuffer }): Promise<Blob | null> {
  try {
    const pdfjs = await loadPdfJs();
    const document_ = await pdfjs.getDocument({ ...PDF_SOURCE_OPTIONS, ...source }).promise;
    return await coverFromDocument(document_);
  } catch {
    // Que no se pueda generar la portada no puede impedir subir el libro.
    return null;
  }
}

/**
 * Pinta la primera página de un documento **ya abierto**.
 *
 * El lector la usa con el suyo: volver a abrir el PDF sólo para la portada
 * significaría descargarlo dos veces, y además por una ruta que necesita la
 * cookie de sesión.
 */
async function coverFromDocument(document_: PdfDocument): Promise<Blob | null> {
  try {
    const page = await document_.getPage(1);

    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: COVER_WIDTH / base.width });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const context = canvas.getContext('2d');
    if (!context) return null;

    // Fondo blanco: un PDF con transparencia quedaría sobre negro en el lienzo.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.82);
    });
  } catch {
    return null;
  }
}

/** Sube una imagen como portada de un documento. */
async function putCover(documentId: string, blob: Blob): Promise<void> {
  await fetch(`/api/documentos/${documentId}/portada`, {
    method: 'PUT',
    body: blob,
    credentials: 'same-origin',
    headers: { 'Content-Type': blob.type || 'image/jpeg', 'X-CSRF-Token': csrf() },
  });
}

async function initReader(): Promise<void> {
  const root = document.querySelector<HTMLElement>('[data-reader]');
  if (!root) return;

  const documentId = root.dataset.documentId!;
  const pane = root.querySelector<HTMLElement>('[data-pages]')!;
  const pageInput = root.querySelector<HTMLInputElement>('[data-page-input]');
  const pageTotal = root.querySelector<HTMLElement>('[data-page-total]');
  const zoomLabel = root.querySelector<HTMLElement>('[data-zoom-label]');
  const savedLabel = root.querySelector<HTMLElement>('[data-saved-label]');
  const selectionBar = root.querySelector<HTMLElement>('[data-selection-bar]');
  const notesList = root.querySelector<HTMLElement>('[data-notes-list]');
  const notesEmpty = root.querySelector<HTMLElement>('[data-notes-empty]');

  const pdfjs = await loadPdfJs();
  const document_ = await pdfjs.getDocument({
    ...PDF_SOURCE_OPTIONS,
    url: root.dataset.file!,
    // Cookies de sesión: el PDF sale de una ruta autenticada.
    withCredentials: true,
  }).promise;

  if (pageTotal) pageTotal.textContent = `/ ${document_.numPages}`;
  if (pageInput) pageInput.max = String(document_.numPages);

  // El número de páginas sólo lo sabe quien abre el PDF: el Worker no lo puede
  // calcular sin traerse una librería entera. Se manda una vez.
  if (!root.dataset.pageCount) {
    api(`/api/documentos/${documentId}/paginas`, {
      method: 'PUT',
      body: JSON.stringify({ pageCount: document_.numPages }),
    }).catch(() => undefined);
    root.dataset.pageCount = String(document_.numPages);
  }

  /**
   * Escala a la que se pinta el documento.
   *
   * No es un valor fijo: 1,2 iba bien en un portátil y dejaba la página
   * desbordando por la derecha en cualquier móvil, con desplazamiento
   * horizontal para leer cada línea. Se parte de la escala que hace que la
   * página quepa de ancho, sin pasar de 1,2 en pantallas grandes.
   */
  let scale = 1.2;
  /** Deja de recalcularse en cuanto alguien toca el zoom: manda su decisión. */
  let zoomTouched = false;

  /** Escala a la que la página ocupa justo el ancho útil del panel. */
  async function fitScale(): Promise<number> {
    const page = await document_.getPage(1);
    const width = page.getViewport({ scale: 1 }).width;
    // El panel tiene relleno a los lados, y hay que dejar sitio a la barra de
    // desplazamiento vertical donde ocupa espacio.
    const available = pane.clientWidth - 8;
    if (!width || available <= 0) return 1;
    return Math.max(0.35, Math.min(3, available / width));
  }

  let annotations: Annotation[] = await api<Annotation[]>(`/api/documentos/${documentId}/anotaciones`).catch(() => []);

  const sections = new Map<number, HTMLElement>();
  const rendered = new Set<number>();

  /** Un hueco por página, con su altura real reservada desde el principio. */
  async function layout(): Promise<void> {
    pane.textContent = '';
    sections.clear();
    rendered.clear();

    for (let number = 1; number <= document_.numPages; number += 1) {
      const page = await document_.getPage(number);
      const viewport = page.getViewport({ scale });

      const section = document.createElement('section');
      section.className = 'pdfpage';
      section.dataset.pageNumber = String(number);
      /*
       * pdf.js dimensiona cada fragmento de la capa de texto con
       * `calc(var(--total-scale-factor) * …)`. Sin esta variable el `calc()` no
       * es válido y los fragmentos quedan con un tamaño que no corresponde al
       * de las letras dibujadas: la selección abarca más que el texto y deja
       * huecos al final de cada línea. La pone la aplicación, no la librería.
       */
      section.style.setProperty('--total-scale-factor', String(scale));
      // Reservar el tamaño exacto antes de pintar evita que la página dé saltos
      // según van llegando los renders.
      section.style.width = `${Math.floor(viewport.width)}px`;
      section.style.height = `${Math.floor(viewport.height)}px`;

      const canvas = document.createElement('canvas');
      canvas.className = 'pdfpage__canvas';
      const textLayer = document.createElement('div');
      textLayer.className = 'pdfpage__text textLayer';
      const highlightLayer = document.createElement('div');
      highlightLayer.className = 'pdfpage__marks';

      section.append(canvas, textLayer, highlightLayer);
      pane.appendChild(section);
      sections.set(number, section);
      observer.observe(section);
    }
    paintAnnotations();
  }

  /** Se pinta lo que se ve y su entorno, no las 600 páginas del libro. */
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const number = Number((entry.target as HTMLElement).dataset.pageNumber);
        void renderPage(number);
      });
    },
    { root: pane, rootMargin: '200% 0px' },
  );

  async function renderPage(number: number): Promise<void> {
    if (rendered.has(number)) return;
    rendered.add(number);

    const section = sections.get(number);
    if (!section) return;

    const page = await document_.getPage(number);
    const viewport = page.getViewport({ scale });
    section.style.setProperty('--total-scale-factor', String(scale));
    const canvas = section.querySelector('canvas')!;
    const context = canvas.getContext('2d');
    if (!context) return;

    // El lienzo se dibuja a la resolución real de la pantalla: en un móvil de
    // 3x, hacerlo a 1x deja el texto borroso.
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.floor(viewport.width * ratio);
    canvas.height = Math.floor(viewport.height * ratio);
    canvas.style.width = `${Math.floor(viewport.width)}px`;
    canvas.style.height = `${Math.floor(viewport.height)}px`;
    context.scale(ratio, ratio);

    await page.render({ canvasContext: context, viewport }).promise;

    // La capa de texto es lo que permite seleccionar y, por tanto, subrayar.
    const textContainer = section.querySelector<HTMLElement>('.pdfpage__text');
    if (textContainer) {
      textContainer.textContent = '';
      textContainer.style.width = `${Math.floor(viewport.width)}px`;
      textContainer.style.height = `${Math.floor(viewport.height)}px`;
      const layer = new pdfjs.TextLayer({
        textContentSource: page.streamTextContent({ includeMarkedContent: true }),
        container: textContainer,
        viewport,
      });
      await layer.render();
      addEndOfContent(textContainer);
    }
  }

  /**
   * El «fin de contenido» que añade el visor oficial de pdf.js y que la
   * librería por sí sola no pone.
   *
   * Los fragmentos de texto están posicionados en absoluto y su orden en el
   * documento no es siempre el orden visual. Sin esto, arrastrar hasta el final
   * de una línea extendía la selección por los huecos vacíos de la página.
   * Mientras se arrastra, la clase `selecting` hace que este bloque cubra la
   * capa entera y la selección se comporta como en un texto corriente.
   */
  function addEndOfContent(container: HTMLElement): void {
    if (container.querySelector('.endOfContent')) return;

    const end = document.createElement('div');
    end.className = 'endOfContent';
    container.appendChild(end);

    container.addEventListener('pointerdown', () => container.classList.add('selecting'));
  }

  // Se quita al soltar en cualquier parte, no sólo dentro de la página: se
  // arrastra hacia abajo y se suelta fuera constantemente.
  document.addEventListener('pointerup', () => {
    pane.querySelectorAll('.selecting').forEach((layer) => layer.classList.remove('selecting'));
  });

  // ------------------------------------------------------- anotaciones --
  /**
   * Los subrayados se guardan en coordenadas normalizadas (0..1) sobre la
   * página, así que se repintan bien con cualquier zoom y en cualquier pantalla.
   */
  function paintAnnotations(): void {
    sections.forEach((section, number) => {
      const marks = section.querySelector<HTMLElement>('.pdfpage__marks');
      if (!marks) return;
      marks.textContent = '';

      annotations
        .filter((annotation) => annotation.page === number && annotation.rects.length)
        .forEach((annotation) => {
          annotation.rects.forEach((rect) => {
            const mark = document.createElement('span');
            mark.className = `pdfmark pdfmark--${annotation.color.toLowerCase()}`;
            mark.dataset.annotationId = annotation.id;
            mark.style.left = `${rect.x * 100}%`;
            mark.style.top = `${rect.y * 100}%`;
            mark.style.width = `${rect.w * 100}%`;
            mark.style.height = `${rect.h * 100}%`;
            marks.appendChild(mark);
          });
        });
    });
    renderNotesList();
  }

  function renderNotesList(): void {
    if (!notesList) return;
    notesList.textContent = '';
    if (notesEmpty) notesEmpty.hidden = annotations.length > 0;

    annotations
      .slice()
      .sort((a, b) => a.page - b.page)
      .forEach((annotation) => {
        const item = document.createElement('li');
        item.className = `note note--${annotation.color.toLowerCase()}`;
        item.dataset.annotationId = annotation.id;
        item.dataset.page = String(annotation.page);

        const jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'note__jump';
        jump.dataset.jump = '';

        const pageTag = document.createElement('span');
        pageTag.className = 'note__page';
        pageTag.textContent = `p. ${annotation.page}`;
        jump.appendChild(pageTag);

        if (annotation.quote) {
          const quote = document.createElement('span');
          quote.className = 'note__quote';
          // `textContent`, nunca `innerHTML`: el texto sale de un PDF que
          // podría llevar cualquier cosa dentro.
          quote.textContent = annotation.quote;
          jump.appendChild(quote);
        }
        item.appendChild(jump);

        if (annotation.body) {
          const body = document.createElement('p');
          body.className = 'note__body';
          body.textContent = annotation.body;
          item.appendChild(body);
        }

        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'note__delete';
        remove.dataset.deleteAnnotation = '';
        remove.setAttribute('aria-label', 'Borrar anotación');
        remove.textContent = '×';
        item.appendChild(remove);

        notesList.appendChild(item);
      });
  }

  /** Rectángulos de la selección, relativos a la página que la contiene. */
  function selectionRects(): { page: number; rects: { x: number; y: number; w: number; h: number }[]; quote: string } | null {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;

    const range = selection.getRangeAt(0);
    const container = range.startContainer.parentElement?.closest<HTMLElement>('.pdfpage');
    if (!container) return null;

    const pageNumber = Number(container.dataset.pageNumber);
    const base = container.getBoundingClientRect();
    const clamp = (value: number) => Math.min(1, Math.max(0, value));

    const rects = [...range.getClientRects()]
      .filter((rect) => rect.width > 1 && rect.height > 1)
      .map((rect) => ({
        x: (rect.left - base.left) / base.width,
        y: (rect.top - base.top) / base.height,
        w: rect.width / base.width,
        h: rect.height / base.height,
      }))
      /*
       * Una selección puede cruzar de página: los rectángulos de la siguiente
       * quedan fuera del recuadro de ésta y hay que tirarlos, no recortarlos —
       * recortados se pintarían aplastados contra el borde de la página
       * equivocada. Se decide por el centro del rectángulo.
       */
      .filter((rect) => {
        const centerY = rect.y + rect.h / 2;
        return centerY >= 0 && centerY <= 1;
      })
      /*
       * Lo que sí se recorta es el error de subpíxel de medir el DOM: empezar
       * la selección en el borde izquierdo daba un `x` de -0,0004, y eso
       * tumbaba la anotación entera con un 400.
       */
      .map((rect) => ({
        x: clamp(rect.x),
        y: clamp(rect.y),
        w: clamp(rect.w),
        h: clamp(rect.h),
      }))
      .filter((rect) => rect.w > 0 && rect.h > 0)
      // Una selección larga produce un rectángulo por línea. 200 es de sobra y
      // es el techo que acepta el servidor.
      .slice(0, 200);

    if (!rects.length) return null;
    return { page: pageNumber, rects, quote: selection.toString().trim().slice(0, 2000) };
  }

  function positionSelectionBar(): void {
    if (!selectionBar) return;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      selectionBar.hidden = true;
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    if (!rect.width && !rect.height) {
      selectionBar.hidden = true;
      return;
    }
    selectionBar.hidden = false;

    /*
     * La barra se centra sobre la selección, pero no puede salirse de la
     * pantalla: seleccionando cerca del borde —lo normal en un móvil— la mitad
     * de los botones quedaban fuera y no se podían pulsar. Se sujeta a los
     * márgenes, contando el ancho real de la barra, que ya está pintada.
     */
    const half = selectionBar.offsetWidth / 2 || 90;
    const margin = 8;
    const x = Math.min(Math.max(rect.left + rect.width / 2, half + margin), window.innerWidth - half - margin);

    // Si no cabe encima de la selección, se pone debajo en vez de salirse.
    const above = rect.top - 8;
    const y = above - selectionBar.offsetHeight < margin ? rect.bottom + selectionBar.offsetHeight + margin : above;

    selectionBar.style.left = `${x}px`;
    selectionBar.style.top = `${y}px`;
  }

  document.addEventListener('selectionchange', () => {
    if (root.contains(document.activeElement) || pane.contains(window.getSelection()?.anchorNode ?? null)) {
      positionSelectionBar();
    }
  });

  async function createAnnotation(kind: 'HIGHLIGHT' | 'NOTE', color: Annotation['color'], body: string | null): Promise<void> {
    const selected = selectionRects();
    if (!selected) return;

    try {
      const created = await api<Annotation>(`/api/documentos/${documentId}/anotaciones`, {
        method: 'POST',
        body: JSON.stringify({
          kind,
          page: selected.page,
          rects: selected.rects,
          quote: selected.quote,
          // `undefined` y no `null`: `JSON.stringify` quita la clave entera, que
          // es lo que el servidor entiende por «vacío». Un subrayado sin nota
          // mandaba `body: null` y se rechazaba con un 400.
          body: body ?? undefined,
          color,
        }),
      });
      annotations.push(created);
      paintAnnotations();
      window.getSelection()?.removeAllRanges();
      if (selectionBar) selectionBar.hidden = true;
    } catch (error) {
      toast(error instanceof Error ? error.message : 'No se ha podido guardar.', 'error');
    }
  }

  /*
   * Pulsar un botón deshace la selección de texto en cuanto baja el ratón, y
   * entonces no queda nada que subrayar cuando llega el `click`. Cancelando el
   * comportamiento por omisión del `mousedown` la selección sobrevive. Va en la
   * barra entera, botones de color y de nota incluidos.
   */
  selectionBar?.addEventListener('mousedown', (event) => event.preventDefault());

  selectionBar?.querySelectorAll<HTMLButtonElement>('[data-highlight]').forEach((button) => {
    button.addEventListener('click', () => {
      void createAnnotation('HIGHLIGHT', (button.dataset.highlight as Annotation['color']) ?? 'YELLOW', null);
    });
  });

  selectionBar?.querySelector<HTMLButtonElement>('[data-add-note]')?.addEventListener('click', () => {
    const body = window.prompt('Nota');
    if (body && body.trim()) void createAnnotation('NOTE', 'YELLOW', body.trim().slice(0, 4000));
  });

  notesList?.addEventListener('click', async (event) => {
    const target = event.target as HTMLElement;
    const item = target.closest<HTMLElement>('[data-annotation-id]');
    if (!item) return;
    const id = item.dataset.annotationId!;

    if (target.closest('[data-delete-annotation]')) {
      try {
        await api(`/api/documentos/${documentId}/anotaciones/${id}`, { method: 'DELETE' });
        annotations = annotations.filter((annotation) => annotation.id !== id);
        paintAnnotations();
      } catch {
        toast('No se ha podido borrar la anotación.', 'error');
      }
      return;
    }

    if (target.closest('[data-jump]')) {
      // En móvil el panel está encima del documento: saltar a una nota sin
      // cerrarlo llevaba a mirar una página tapada.
      if (window.matchMedia('(max-width: 900px)').matches) root.classList.remove('reader--notes-open');
      sections.get(Number(item.dataset.page))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });

  root.querySelector('[data-toggle-notes]')?.addEventListener('click', () => {
    root.classList.toggle('reader--notes-open');
  });

  root.querySelector('[data-close-notes]')?.addEventListener('click', () => {
    root.classList.remove('reader--notes-open');
  });

  // ---------------------------------------------------------- posición --
  function currentPage(): { page: number; scrollPct: number } {
    const top = pane.scrollTop;
    for (const [number, section] of sections) {
      const start = section.offsetTop - pane.offsetTop;
      const end = start + section.offsetHeight;
      if (top >= start - 4 && top < end) {
        return { page: number, scrollPct: Math.round(((top - start) / section.offsetHeight) * 1000) };
      }
    }
    return { page: 1, scrollPct: 0 };
  }

  let saveTimer = 0;
  function scheduleSave(): void {
    window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => void saveProgress(), 1200);
  }

  async function saveProgress(): Promise<void> {
    const position = currentPage();
    if (pageInput) pageInput.value = String(position.page);
    try {
      await api(`/api/documentos/${documentId}/progreso`, {
        method: 'PUT',
        body: JSON.stringify(position),
      });
      if (savedLabel) savedLabel.textContent = `Guardado en la página ${position.page}`;
    } catch {
      if (savedLabel) savedLabel.textContent = 'No se ha podido guardar la posición';
    }
  }

  pane.addEventListener('scroll', scheduleSave, { passive: true });

  // Al cerrar la pestaña o cambiar de aplicación no da tiempo a un `fetch`
  // normal: `keepalive` deja que la petición termine aunque el documento muera.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    const position = currentPage();
    fetch(`/api/documentos/${documentId}/progreso`, {
      method: 'PUT',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf() },
      body: JSON.stringify(position),
    }).catch(() => undefined);
  });

  // -------------------------------------------------------------- zoom --
  /** `next` a 0 significa «vuelve a ajustar al ancho». */
  async function setScale(next: number): Promise<void> {
    const target = next > 0 ? next : await fitScale();
    scale = Math.max(0.35, Math.min(3, Number(target.toFixed(2))));
    if (zoomLabel) zoomLabel.textContent = `${Math.round(scale * 100)}%`;
    const position = currentPage();
    await layout();
    sections.get(position.page)?.scrollIntoView({ block: 'start' });
  }

  root.querySelector('[data-zoom-in]')?.addEventListener('click', () => {
    zoomTouched = true;
    void setScale(scale + 0.2);
  });
  root.querySelector('[data-zoom-out]')?.addEventListener('click', () => {
    zoomTouched = true;
    void setScale(scale - 0.2);
  });

  /*
   * Girar el móvil cambia el ancho útil a la mitad o al doble. Sin esto, la
   * página se quedaba con la escala del arranque: o desbordando, o convertida
   * en una columna estrecha con la mitad de la pantalla vacía.
   *
   * Se ignora si esa persona ya ha ajustado el zoom a mano.
   */
  let resizeTimer = 0;
  let lastWidth = pane.clientWidth;
  window.addEventListener('resize', () => {
    if (zoomTouched) return;
    // Al desplegarse el teclado del móvil también salta `resize`, y ahí sólo
    // cambia el alto: si el ancho es el mismo, no hay nada que repintar.
    if (Math.abs(pane.clientWidth - lastWidth) < 24) return;
    lastWidth = pane.clientWidth;
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => void setScale(0), 250);
  });

  pageInput?.addEventListener('change', () => {
    const target = Number(pageInput.value);
    if (Number.isInteger(target)) sections.get(target)?.scrollIntoView({ block: 'start' });
  });

  // ------------------------------------------------------- arranque --
  // Nunca más ancho que el panel. En un portátil sale 1,2 como antes; en un
  // móvil, lo que quepa.
  scale = Math.min(1.2, await fitScale());
  if (zoomLabel) zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  await layout();

  /*
   * Los documentos subidos antes de que existieran las portadas no tienen
   * ninguna. Aquí pdf.js ya está cargado y el PDF abierto, así que generarla
   * sale gratis: se hace una vez y la estantería la enseña a partir de entonces.
   */
  if (!root.dataset.hasCover) {
    void (async () => {
      const blob = await coverFromDocument(document_);
      if (blob) {
        await putCover(documentId, blob).catch(() => undefined);
        root.dataset.hasCover = '1';
      }
    })();
  }

  // Volver justo a donde se dejó la lectura, no al principio del libro.
  const startPage = Number(root.dataset.startPage ?? '1');
  const startScroll = Number(root.dataset.startScroll ?? '0');
  const startSection = sections.get(startPage);
  if (startSection) {
    pane.scrollTop = startSection.offsetTop - pane.offsetTop + (startScroll / 1000) * startSection.offsetHeight;
  }
}

// -------------------------------------------------- biblioteca física --
interface BookDraft {
  isbn13: string;
  isbn10: string | null;
  title: string;
  subtitle: string | null;
  authors: string | null;
  publisher: string | null;
  publishedYear: number | null;
  pageCount: number | null;
  language: string | null;
  coverUrl: string | null;
}

function initBookEditor(): void {
  const root = document.querySelector<HTMLElement>('[data-book-editor]');
  if (!root) return;

  // Referencia ya comprobada: las funciones declaradas más abajo se hoistean y
  // TypeScript no arrastra hasta ellas el estrechamiento del `if` de arriba.
  const scope: HTMLElement = root;
  const isbnInput = scope.querySelector<HTMLInputElement>('[data-isbn-input]');
  const status = scope.querySelector<HTMLElement>('[data-isbn-status]');

  const setStatus = (message: string) => {
    if (status) status.textContent = message;
  };

  /** Vuelca en el formulario lo que ha devuelto Open Library. */
  function fill(draft: BookDraft): void {
    const set = (selector: string, value: string | number | null) => {
      const field = scope.querySelector<HTMLInputElement>(selector);
      // Nunca se pisa lo que ya haya escrito una persona.
      if (field && !field.value && value !== null && value !== undefined) field.value = String(value);
    };
    set('[data-field-title]', draft.title);
    set('[data-field-subtitle]', draft.subtitle);
    set('[data-field-authors]', draft.authors);
    set('[data-field-publisher]', draft.publisher);
    set('[data-field-year]', draft.publishedYear);
    set('[data-field-pages]', draft.pageCount);
    set('[data-field-language]', draft.language);
    set('[data-field-isbn13]', draft.isbn13);

    const isbn10 = scope.querySelector<HTMLInputElement>('[data-isbn10]');
    if (isbn10) isbn10.value = draft.isbn10 ?? '';

    // La portada no se enlaza: se manda la URL y el servidor la descarga y la
    // guarda en R2 al crear el libro.
    const coverUrl = scope.querySelector<HTMLInputElement>('[data-cover-url]');
    if (coverUrl) coverUrl.value = draft.coverUrl ?? '';
  }

  async function lookup(rawIsbn: string): Promise<void> {
    const isbn = rawIsbn.trim();
    if (!isbn) return;
    setStatus('Buscando…');
    try {
      const result = await api<{ draft: BookDraft; existing: { id: string; title: string } | null }>('/api/isbn', {
        method: 'POST',
        body: JSON.stringify({ isbn }),
      });
      if (result.existing) {
        setStatus(`Ese libro ya está en el catálogo: «${result.existing.title}».`);
        return;
      }
      fill(result.draft);
      setStatus(result.draft.title ? `Ficha encontrada: ${result.draft.title}` : 'Sin ficha en Open Library. Rellénala a mano.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'No se ha podido consultar el ISBN.');
    }
  }

  scope.querySelector('[data-isbn-lookup]')?.addEventListener('click', () => void lookup(isbnInput?.value ?? ''));
  isbnInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void lookup(isbnInput.value);
    }
  });

  initScanner(scope, (isbn) => {
    if (isbnInput) isbnInput.value = isbn;
    void lookup(isbn);
  });

  initCoverUpload(scope);
}

/**
 * Escáner de códigos de barras.
 *
 * Con `BarcodeDetector` nativo donde lo hay (Chrome y Android), que es rápido y
 * no descarga nada. Donde no lo hay —Safari, Firefox— se carga ZXing a mano en
 * ese momento. Sin esa reserva, la cámara no funcionaría justo en el navegador
 * de un iPhone, que es donde más sentido tiene escanear un libro.
 */
function initScanner(root: HTMLElement, onDetected: (isbn: string) => void): void {
  const panel = root.querySelector<HTMLElement>('[data-scanner]');
  const video = root.querySelector<HTMLVideoElement>('[data-scanner-video]');
  const startButton = root.querySelector<HTMLButtonElement>('[data-scan-start]');
  const stopButton = root.querySelector<HTMLButtonElement>('[data-scan-stop]');
  const status = root.querySelector<HTMLElement>('[data-isbn-status]');
  if (!panel || !video || !startButton) return;

  let stream: MediaStream | null = null;
  let frameTimer = 0;
  let decodeFallback: ((canvas: HTMLCanvasElement) => string | null) | null = null;
  const canvas = document.createElement('canvas');

  function stop(): void {
    window.clearInterval(frameTimer);
    stream?.getTracks().forEach((track) => track.stop());
    stream = null;
    panel!.hidden = true;
    video!.srcObject = null;
  }

  async function start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      if (status) status.textContent = 'Este navegador no da acceso a la cámara. Escribe el ISBN a mano.';
      return;
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // La cámara trasera es la que apunta al libro.
        video: { facingMode: 'environment', width: { ideal: 1280 } },
        audio: false,
      });
    } catch {
      if (status) status.textContent = 'No se ha podido abrir la cámara. Revisa el permiso del navegador.';
      return;
    }

    panel!.hidden = false;
    video!.srcObject = stream;
    await video!.play().catch(() => undefined);

    const native = 'BarcodeDetector' in window
      ? new (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => { detect(source: CanvasImageSource): Promise<{ rawValue: string }[]> } })
          .BarcodeDetector({ formats: ['ean_13', 'ean_8'] })
      : null;

    if (!native && !decodeFallback) {
      if (status) status.textContent = 'Preparando el lector…';
      const modulePath = '/assets/scanner.js';
      const module_ = (await import(/* @vite-ignore */ modulePath)) as { decodeFrame(c: HTMLCanvasElement): string | null };
      decodeFallback = module_.decodeFrame;
    }
    if (status) status.textContent = 'Enfoca el código de barras de la contraportada.';

    // Cuatro fotogramas por segundo: suficiente para que se sienta inmediato y
    // poco para no freír la batería descodificando vídeo.
    frameTimer = window.setInterval(async () => {
      if (!video!.videoWidth) return;
      canvas.width = video!.videoWidth;
      canvas.height = video!.videoHeight;
      canvas.getContext('2d', { willReadFrequently: true })?.drawImage(video!, 0, 0);

      let code: string | null = null;
      if (native) {
        const found = await native.detect(canvas).catch(() => []);
        code = found[0]?.rawValue ?? null;
      } else if (decodeFallback) {
        code = decodeFallback(canvas);
      }

      if (code) {
        stop();
        onDetected(code);
      }
    }, 250);
  }

  startButton.addEventListener('click', () => void start());
  stopButton?.addEventListener('click', stop);
  // La cámara se apaga al salir de la página: dejarla encendida sería una
  // sorpresa desagradable y gasta batería.
  window.addEventListener('pagehide', stop);

  if (root.dataset.scanOnLoad) void start();
}

/** Portada del libro, con el mismo pipeline validado que las de las reseñas. */
function initCoverUpload(root: HTMLElement): void {
  const uploader = root.querySelector<HTMLElement>('[data-cover-uploader]');
  if (!uploader) return;

  const input = uploader.querySelector<HTMLInputElement>('[data-cover-input]');
  const keyField = root.querySelector<HTMLInputElement>('[data-cover-key]');
  let preview = uploader.querySelector<HTMLImageElement>('[data-cover-preview]');
  let empty = uploader.querySelector<HTMLElement>('[data-cover-preview-empty]');
  if (!input || !keyField) return;

  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;

    const body = new FormData();
    body.append('file', file);

    try {
      const response = await fetch('/api/portadas', {
        method: 'POST',
        body,
        credentials: 'same-origin',
        headers: { Accept: 'application/json', 'X-CSRF-Token': csrf() },
      });
      const payload = (await response.json()) as
        | { ok: true; data: { key: string; url: string } }
        | { ok: false; error: { message: string } };
      if (!response.ok || payload.ok === false) {
        toast('error' in payload ? payload.error.message : 'No se ha podido subir la portada.', 'error');
        return;
      }

      keyField.value = payload.data.key;
      // La vista previa usa la URL que devuelve el servidor, no un `blob:`: la
      // CSP no lleva `blob:` en `img-src` para nada que no pinte el visor.
      if (preview) {
        preview.src = payload.data.url;
        preview.hidden = false;
      } else if (empty) {
        const image = document.createElement('img');
        image.src = payload.data.url;
        image.width = 200;
        image.height = 300;
        image.alt = 'Portada seleccionada';
        image.dataset.coverPreview = '1';
        empty.replaceWith(image);
        preview = image;
        empty = null;
      }
      toast('Portada subida. Recuerda guardar el libro.', 'ok');
    } catch {
      toast('Error de red al subir la portada.', 'error');
    } finally {
      input.value = '';
    }
  });
}

// ------------------------------------------------------------- arranque --
function boot(): void {
  initConfirmForms();
  initProgressBars();
  initUpload();
  initCoverActions();
  initBookEditor();
  void initReader().catch((error: unknown) => {
    toast('No se ha podido abrir el PDF.', 'error');
    console.error(error);
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();

export {};
