import type { FC } from 'hono/jsx';
import { Icon } from '../components/icons';
import type { DocumentWithProgress } from '../../../db/repos/documents';
import { MAX_PDF_BYTES, bookCoverUrl } from '../../lib/books';

/** Tamaño legible. Los PDF van de kilobytes a decenas de megas. */
function formatSize(bytes: number): string {
  const mb = bytes / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;
}

/** Cuándo se abrió por última vez, ya redactado: sin fecha no se dice «leído». */
function formatLastRead(ms: number | null): string {
  if (!ms) return 'sin abrir';
  const fecha = new Date(ms).toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
  return `leído ${fecha}`;
}

/**
 * Avance de lectura en tanto por ciento. Sólo se puede calcular cuando el visor
 * ya ha contado las páginas del PDF, cosa que ocurre la primera vez que se abre.
 */
function progress(document: DocumentWithProgress): number | null {
  if (!document.pageCount || !document.progressPage) return null;
  return Math.min(100, Math.round((document.progressPage / document.pageCount) * 100));
}

export const ShelfPage: FC<{ documents: DocumentWithProgress[]; csrfToken: string | null }> = ({
  documents, csrfToken,
}) => (
  <>
    <section class="section-rule">
      <h1 class="page-title">Estantería</h1>
      <p class="page-lead">
        {documents.length === 0
          ? 'Todavía no hay ningún PDF. Sube el primero.'
          : `${documents.length} ${documents.length === 1 ? 'documento' : 'documentos'}.`}
      </p>
    </section>

    {/*
      Plegable, y abierto sólo cuando la estantería está vacía. En un móvil el
      formulario ocupaba la primera pantalla entera y había que desplazarse para
      ver el primer libro, que es a lo que se viene.
    */}
    <details class="panel" data-upload open={documents.length === 0}>
      <summary class="panel__title panel__title--summary">Subir un PDF</summary>
      <form class="upload" data-upload-form>
        <input type="hidden" name="_csrf" value={csrfToken ?? ''} />
        <div class="editor__row">
          <div class="field">
            <label class="field__label" for="f-doc-title">Título</label>
            <input id="f-doc-title" class="input" name="title" maxlength={300} required data-upload-title />
          </div>
          <div class="field">
            <label class="field__label" for="f-doc-author">Autor</label>
            <input id="f-doc-author" class="input" name="author" maxlength={200} data-upload-author />
          </div>
        </div>

        <div class="field">
          <span class="field__label">
            Archivo PDF <span class="field__hint">máximo {MAX_PDF_BYTES / 1024 / 1024} MB</span>
          </span>
          {/* El botón nativo del selector de fichero sale en el idioma del
              navegador y no se puede traducir: se esconde el campo y se usa una
              etiqueta propia, que además dice qué fichero se ha elegido. */}
          <label class="btn btn--ghost filepick">
            <span data-upload-name>Elegir archivo…</span>
            <input class="visually-hidden" type="file" accept="application/pdf" required data-upload-input />
          </label>
        </div>

        {/* Hueco reservado de antemano: la barra aparece al empezar la subida y
            no debe empujar nada hacia abajo cuando lo hace. */}
        <div class="upload__status" data-upload-status aria-live="polite">
          <div class="upload__bar"><span data-upload-bar></span></div>
          <p class="upload__text" data-upload-text></p>
        </div>

        <button type="submit" class="btn btn--primary">
          <Icon name="plus" size={14} />
          <span>Subir</span>
        </button>
      </form>
    </details>

    {documents.length ? (
      <ul class="doclist">
        {documents.map((document) => {
          const percent = progress(document);
          const cover = bookCoverUrl(document.coverKey);
          return (
            <li class="doc">
              <a class="doc__link" href={`/documentos/${document.id}`}>
                <span class="doc__cover">
                  {cover ? (
                    <img class="doc__img" src={cover} alt={`Portada de ${document.title}`} width="48" height="72" loading="lazy" />
                  ) : (
                    /* Hasta que haya portada, un marcador gris del mismo tamaño:
                       así la lista no cambia de forma cuando llega la imagen. */
                    <span class="doc__img doc__img--placeholder" aria-hidden="true">
                      <Icon name="book-open" size={18} />
                    </span>
                  )}
                </span>
                <span class="doc__body">
                  <span class="doc__title">{document.title}</span>
                  {document.author ? <span class="doc__author">{document.author}</span> : null}
                  <span class="doc__meta">
                    {formatSize(document.sizeBytes)} · {formatLastRead(document.lastReadAt)}
                    {document.annotationCount > 0
                      ? ` · ${document.annotationCount} ${document.annotationCount === 1 ? 'anotación' : 'anotaciones'}`
                      : ''}
                  </span>
                </span>
              </a>

              <div class="doc__side">
                {percent !== null ? (
                  <span class="doc__progress" title={`Página ${document.progressPage} de ${document.pageCount}`}>
                    {/* El ancho es un valor dinámico: viaja por un atributo
                        `data-*` y lo aplica el JS, nunca por `style=`. */}
                    <span class="doc__progress-bar" data-progress={percent}></span>
                    <span class="doc__progress-text">{percent}%</span>
                  </span>
                ) : (
                  <span class="doc__progress-text doc__progress-text--muted">sin empezar</span>
                )}

                {/* Controles de portada. La de por omisión la saca el visor de
                    la primera página del PDF al subirlo — esto es para cambiarla. */}
                <div class="doc__cover-actions" data-cover-actions data-document-id={document.id}>
                  <label class="btn btn--ghost btn--sm" title="Subir una portada">
                    <Icon name="plus" size={13} />
                    <span class="visually-hidden">Subir portada</span>
                    <input type="file" class="visually-hidden" accept="image/jpeg,image/png,image/webp,image/avif" data-cover-file />
                  </label>
                  <button class="btn btn--ghost btn--sm" type="button" data-cover-url title="Portada desde una dirección">
                    <Icon name="external" size={13} />
                    <span class="visually-hidden">Portada desde una URL</span>
                  </button>
                </div>

                <form method="post" action={`/documentos/${document.id}/eliminar`} data-confirm="¿Borrar este PDF y todas sus notas?">
                  <input type="hidden" name="_csrf" value={csrfToken ?? ''} />
                  <button class="btn btn--ghost btn--sm" type="submit" aria-label={`Borrar ${document.title}`}>
                    <Icon name="trash" size={14} />
                  </button>
                </form>
              </div>
            </li>
          );
        })}
      </ul>
    ) : null}
  </>
);
