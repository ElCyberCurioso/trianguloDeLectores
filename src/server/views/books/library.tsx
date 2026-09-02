import type { FC } from 'hono/jsx';
import { Icon } from '../components/icons';
import type { LibraryCounters, LibraryRecord } from '../../../db/repos/library';
import { bookCoverUrl } from '../../lib/books';
import { LIBRARY_SORT_LABELS, type LibrarySort } from '../../lib/library-sort';

const STATUS_LABEL: Record<string, string> = {
  OWNED: 'En casa',
  READING: 'Leyendo',
  READ: 'Leído',
  LENT: 'Prestado',
  WISHLIST: 'Lo quiero',
};

/** Singular o plural según la cifra. */
function plural(n: number, singular: string, plural_: string): string {
  return n === 1 ? singular : plural_;
}

/** Nota sobre 10 y con coma, como en todo el sitio. */
function formatRating(value: number | null): string | null {
  return value === null ? null : `${value},0`.replace(',0', value % 1 === 0 ? ',0' : '');
}

export const LibraryPage: FC<{
  books: LibraryRecord[];
  counters: LibraryCounters;
  query: { q?: string; status: string; sort: LibrarySort };
  csrfToken: string | null;
}> = ({ books, counters, query, csrfToken }) => (
  <>
    <section class="section-rule">
      <h1 class="page-title">Biblioteca</h1>
      <p class="page-lead">
        {counters.total} {plural(counters.total, 'libro en papel', 'libros en papel')} · {counters.reading} leyendo ·{' '}
        {counters.read} {plural(counters.read, 'leído', 'leídos')} ·{' '}
        {counters.lent} {plural(counters.lent, 'prestado', 'prestados')}
      </p>
      <p class="page-lead">
        {books.length !== counters.total
          ? `${books.length} ${plural(books.length, 'resultado', 'resultados')} · `
          : ''}
        {/* La etiqueta se deja tal cual: minusculizarla convertía «(A–Z)» en
            «(a–z)», que se lee como si fuera otra cosa. */}
        Orden: {LIBRARY_SORT_LABELS[query.sort]}
      </p>
    </section>

    <div class="library__actions">
      <a class="btn btn--primary" href="/biblioteca/nuevo">
        <Icon name="plus" size={14} />
        <span>Añadir libro</span>
      </a>
      <a class="btn btn--ghost" href="/biblioteca/nuevo?escanear=1">
        <Icon name="camera" size={14} />
        <span>Escanear código</span>
      </a>
    </div>

    <form class="filters filters--library" method="get" action="/biblioteca">
      <div class="filters__row">
        <div class="field field--search">
          <label class="field__label" for="f-q">Buscar</label>
          <input id="f-q" class="input" type="search" name="q" value={query.q ?? ''} placeholder="Título, autor o ISBN" maxlength={120} />
        </div>
        <div class="field">
          <label class="field__label" for="f-status">Estado</label>
          <select id="f-status" class="select" name="status">
            <option value="ALL" selected={query.status === 'ALL'}>Todos</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option value={value} selected={query.status === value}>{label}</option>
            ))}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="f-sort">Ordenar por</label>
          <select id="f-sort" class="select" name="sort">
            {Object.entries(LIBRARY_SORT_LABELS).map(([value, label]) => (
              <option value={value} selected={query.sort === value}>{label}</option>
            ))}
          </select>
        </div>
        <div class="filters__actions">
          <button class="btn btn--ghost btn--sm" type="submit">
            <Icon name="filter" size={13} />
            <span>Aplicar</span>
          </button>
        </div>
      </div>
    </form>

    {books.length === 0 ? (
      <p class="empty">No hay libros que cumplan ese filtro.</p>
    ) : (
      <ul class="booklist">
        {books.map((book) => {
          const cover = bookCoverUrl(book.coverKey);
          const rating = formatRating(book.rating);
          return (
            <li class="bookcard">
              <a class="bookcard__link" href={`/biblioteca/${book.id}`}>
                <span class="bookcard__cover">
                  {cover ? (
                    <img class="bookcard__img" src={cover} alt={`Portada de ${book.title}`} width="200" height="300" loading="lazy" />
                  ) : (
                    <span class="bookcard__img bookcard__img--placeholder" aria-hidden="true">
                      <Icon name="book" size={22} />
                    </span>
                  )}
                </span>
                <span class="bookcard__body">
                  <span class="bookcard__title">{book.title}</span>
                  {book.authors ? <span class="bookcard__authors">{book.authors}</span> : null}
                  <span class="bookcard__meta">
                    {[book.publisher, book.publishedYear, book.pageCount ? `${book.pageCount} pág.` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  <span class="bookcard__tags">
                    <span class="tag">{STATUS_LABEL[book.status] ?? book.status}</span>
                    {rating ? <span class="tag tag--score">{rating}</span> : null}
                    {book.location ? <span class="tag">{book.location}</span> : null}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    )}

    <input type="hidden" value={csrfToken ?? ''} data-csrf />
  </>
);

// ---------------------------------------------------------------- editor --
export const BookEditorPage: FC<{
  book: LibraryRecord | null;
  csrfToken: string | null;
  scanOnLoad?: boolean;
  error?: string | null;
}> = ({ book, csrfToken, scanOnLoad = false, error = null }) => {
  const cover = bookCoverUrl(book?.coverKey);
  return (
    <div class="editor" data-book-editor data-scan-on-load={scanOnLoad ? '1' : ''}>
      <section class="section-rule">
        <h1 class="page-title">{book ? 'Editar libro' : 'Añadir libro'}</h1>
      </section>

      {error ? <p class="flash flash--error" role="alert">{error}</p> : null}

      {!book ? (
        <section class="panel">
          <h2 class="panel__title">Buscar por ISBN</h2>
          <p class="panel__hint">
            Escribe el ISBN o léelo con la cámara. Se rellena la ficha con lo que haya en Open Library y luego
            corriges lo que haga falta.
          </p>

          <div class="isbn">
            <div class="field">
              <label class="field__label" for="f-isbn-lookup">ISBN</label>
              <input id="f-isbn-lookup" class="input" inputmode="numeric" maxlength={20} data-isbn-input />
            </div>
            <button class="btn btn--ghost" type="button" data-isbn-lookup>
              <Icon name="search" size={14} />
              <span>Buscar</span>
            </button>
            <button class="btn btn--ghost" type="button" data-scan-start>
              <Icon name="camera" size={14} />
              <span>Cámara</span>
            </button>
          </div>

          {/* Hueco del vídeo reservado desde el principio: al encender la cámara
              no se mueve nada de lo que hay debajo. */}
          <div class="scanner" data-scanner hidden>
            <video class="scanner__video" data-scanner-video playsinline muted></video>
            <div class="scanner__frame" aria-hidden="true"></div>
            <button class="btn btn--ghost btn--sm scanner__stop" type="button" data-scan-stop>
              <Icon name="close" size={13} />
              <span>Cerrar cámara</span>
            </button>
          </div>
          <p class="isbn__status" data-isbn-status aria-live="polite"></p>
        </section>
      ) : null}

      <form method="post" action={book ? `/biblioteca/${book.id}` : '/biblioteca'} class="panel" data-book-form>
        <input type="hidden" name="_csrf" value={csrfToken ?? ''} />
        <input type="hidden" name="coverKey" value={book?.coverKey ?? ''} data-cover-key />
        <input type="hidden" name="coverUrl" value="" data-cover-url />
        <input type="hidden" name="isbn10" value={book?.isbn10 ?? ''} data-isbn10 />

        <div class="editor__row">
          <div class="field">
            <label class="field__label" for="f-title">Título</label>
            <input id="f-title" class="input" name="title" value={book?.title ?? ''} required maxlength={300} data-field-title />
          </div>
          <div class="field">
            <label class="field__label" for="f-isbn13">ISBN-13</label>
            <input id="f-isbn13" class="input" name="isbn13" value={book?.isbn13 ?? ''} maxlength={20} data-field-isbn13 />
          </div>
        </div>

        <div class="editor__row">
          <div class="field">
            <label class="field__label" for="f-authors">Autores</label>
            <input id="f-authors" class="input" name="authors" value={book?.authors ?? ''} maxlength={300} data-field-authors />
          </div>
          <div class="field">
            <label class="field__label" for="f-publisher">Editorial</label>
            <input id="f-publisher" class="input" name="publisher" value={book?.publisher ?? ''} maxlength={200} data-field-publisher />
          </div>
        </div>

        <div class="editor__row editor__row--3">
          <div class="field">
            <label class="field__label" for="f-year">Año</label>
            <input id="f-year" class="input" type="number" name="publishedYear" value={book?.publishedYear ?? ''} min={1400} max={2200} data-field-year />
          </div>
          <div class="field">
            <label class="field__label" for="f-pages">Páginas</label>
            <input id="f-pages" class="input" type="number" name="pageCount" value={book?.pageCount ?? ''} min={1} max={50000} data-field-pages />
          </div>
          <div class="field">
            <label class="field__label" for="f-language">Idioma</label>
            <input id="f-language" class="input" name="language" value={book?.language ?? ''} maxlength={20} data-field-language />
          </div>
        </div>

        <div class="editor__row editor__row--3">
          <div class="field">
            <label class="field__label" for="f-status-book">Estado</label>
            <select id="f-status-book" class="select" name="status">
              {Object.entries(STATUS_LABEL).map(([value, label]) => (
                <option value={value} selected={(book?.status ?? 'OWNED') === value}>{label}</option>
              ))}
            </select>
          </div>
          <div class="field">
            <label class="field__label" for="f-location">Dónde está</label>
            <input id="f-location" class="input" name="location" value={book?.location ?? ''} maxlength={120} placeholder="Estantería, balda…" />
          </div>
          <div class="field">
            <label class="field__label" for="f-rating">Nota (0–10)</label>
            <input id="f-rating" class="input" type="number" name="rating" value={book?.rating ?? ''} min={0} max={10} />
          </div>
        </div>

        <div class="field">
          <label class="field__label" for="f-subtitle">Subtítulo</label>
          <input id="f-subtitle" class="input" name="subtitle" value={book?.subtitle ?? ''} maxlength={300} data-field-subtitle />
        </div>

        <div class="field">
          <label class="field__label" for="f-notes">Notas</label>
          <textarea id="f-notes" class="textarea" name="notes" maxlength={4000} rows={4}>{book?.notes ?? ''}</textarea>
        </div>

        <div class="cover-uploader" data-cover-uploader>
          <span class="field__label">Portada</span>
          <div class="cover-uploader__preview">
            {cover ? (
              <img src={cover} alt="Portada actual" data-cover-preview width="200" height="300" />
            ) : (
              <div class="cover-uploader__empty" data-cover-preview-empty>Sin portada</div>
            )}
          </div>
          <label class="btn btn--ghost btn--block">
            <span>Subir imagen</span>
            <input type="file" class="visually-hidden" accept="image/jpeg,image/png,image/webp,image/avif" data-cover-input />
          </label>
        </div>

        <div class="editor__footer">
          <button class="btn btn--primary" type="submit">Guardar</button>
          <a class="btn btn--ghost" href="/biblioteca">Cancelar</a>
        </div>
      </form>

      {book ? (
        <form method="post" action={`/biblioteca/${book.id}/eliminar`} class="panel" data-confirm="¿Borrar este libro del catálogo?">
          <input type="hidden" name="_csrf" value={csrfToken ?? ''} />
          <button class="btn btn--ghost btn--sm" type="submit">
            <Icon name="trash" size={14} />
            <span>Borrar del catálogo</span>
          </button>
        </form>
      ) : null}
    </div>
  );
};
