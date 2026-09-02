import type { FC } from 'hono/jsx';
import { Icon } from '../components/icons';
import type { AnnotationRecord, DocumentWithProgress } from '../../../db/repos/documents';

/**
 * Visor de PDF.
 *
 * El servidor pinta la cáscara y deja los datos en atributos `data-*`; todo lo
 * demás —render de páginas, capa de texto, subrayados, guardado de posición— lo
 * hace `assets/books.js` con pdf.js. No hay ni un valor dinámico en un atributo
 * `style`: la CSP no lleva `unsafe-inline` y no va a llevarlo.
 */
export const ReaderPage: FC<{
  document: DocumentWithProgress;
  annotations: AnnotationRecord[];
  csrfToken: string | null;
}> = ({ document, annotations, csrfToken }) => (
  <div
    class="reader"
    data-reader
    data-document-id={document.id}
    data-file={`/documentos/${document.id}/fichero`}
    data-start-page={document.progressPage ?? 1}
    data-start-scroll={document.progressScrollPct ?? 0}
    data-page-count={document.pageCount ?? ''}
    data-has-cover={document.coverKey ? '1' : ''}
    data-csrf={csrfToken ?? ''}
  >
    <div class="reader__bar">
      <a class="btn btn--ghost btn--sm" href="/" aria-label="Volver a la estantería">
        <Icon name="list" size={14} />
        <span>Estantería</span>
      </a>

      <h1 class="reader__title">{document.title}</h1>

      <div class="reader__controls">
        <button class="icon-btn" type="button" data-zoom-out aria-label="Reducir">−</button>
        <span class="reader__zoom" data-zoom-label>100%</span>
        <button class="icon-btn" type="button" data-zoom-in aria-label="Ampliar">+</button>

        <span class="reader__pages">
          <label class="visually-hidden" for="f-page">Página</label>
          <input id="f-page" class="input reader__page-input" type="number" min={1} value={document.progressPage ?? 1} data-page-input />
          <span class="reader__page-total" data-page-total>{document.pageCount ? `/ ${document.pageCount}` : ''}</span>
        </span>

        <button class="icon-btn" type="button" data-toggle-notes aria-label="Notas y subrayados">
          <Icon name="note" size={16} />
        </button>
      </div>
    </div>

    {/* Barra flotante que aparece al seleccionar texto. Su hueco existe desde
        el primer pintado: se muestra y se oculta, nunca se inserta. */}
    <div class="reader__selection" data-selection-bar hidden>
      <button type="button" class="swatch swatch--yellow" data-highlight="YELLOW" aria-label="Subrayar en amarillo"></button>
      <button type="button" class="swatch swatch--green" data-highlight="GREEN" aria-label="Subrayar en verde"></button>
      <button type="button" class="swatch swatch--blue" data-highlight="BLUE" aria-label="Subrayar en azul"></button>
      <button type="button" class="swatch swatch--red" data-highlight="RED" aria-label="Subrayar en rojo"></button>
      <button type="button" class="btn btn--ghost btn--sm" data-add-note>
        <Icon name="note" size={13} />
        <span>Nota</span>
      </button>
    </div>

    <div class="reader__body">
      <div class="reader__pane" data-pages tabindex={0}>
        {/* pdf.js inserta aquí un <section> por página. */}
      </div>

      <aside class="reader__notes" data-notes-panel>
        <div class="reader__notes-head">
          <h2 class="panel__title">
            <Icon name="highlighter" size={14} />
            <span>Notas y subrayados</span>
          </h2>
          {/* En móvil el panel se abre encima de todo, incluido el botón de la
              barra que lo abrió: sin este, no habría forma de cerrarlo. */}
          <button class="icon-btn reader__notes-close" type="button" data-close-notes aria-label="Cerrar notas">
            <Icon name="close" size={14} />
          </button>
        </div>
        <p class="reader__notes-empty" data-notes-empty hidden={annotations.length > 0}>
          Selecciona texto en el documento para subrayarlo o añadir una nota.
        </p>
        <ul class="notelist" data-notes-list>
          {annotations.map((annotation) => (
            <li class={`note note--${annotation.color.toLowerCase()}`} data-annotation-id={annotation.id} data-page={annotation.page}>
              <button class="note__jump" type="button" data-jump>
                <span class="note__page">p. {annotation.page}</span>
                {annotation.quote ? <span class="note__quote">{annotation.quote}</span> : null}
              </button>
              {annotation.body ? <p class="note__body">{annotation.body}</p> : null}
              <button class="note__delete" type="button" data-delete-annotation aria-label="Borrar anotación">
                <Icon name="close" size={12} />
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>

    <p class="reader__saved" data-saved-label aria-live="polite"></p>
  </div>
);
