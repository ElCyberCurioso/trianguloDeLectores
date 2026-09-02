import { parseIsbn } from './isbn';
import { extractYear } from './year';
import type { LibraryStatus } from '../../db/repos/library';

/**
 * Traducción de una ficha de MyLibrary a una de la biblioteca.
 *
 * MyLibrary es la aplicación de Android desde la que se exporta el catálogo.
 * Su formato tiene campos que aquí no existen —serie, categorías, resumen,
 * fechas de lectura, enlaces a tiendas— y perderlos al importar sería tirar
 * datos que costó meter a mano. En vez de inventar columnas, todo eso se
 * compone en `notes` con su etiqueta, que es legible y sigue siendo buscable.
 *
 * La conversión vive aquí y no en el script de importación para que se pueda
 * probar: es donde están las decisiones discutibles.
 */

/** Ficha tal y como sale de la base de MyLibrary, ya con los autores resueltos. */
export interface MyLibraryBook {
  /** `BOOK.ID` en el fichero de origen. Sólo para poder rastrear el registro. */
  sourceId: number;
  title: string;
  author: string | null;
  additionalAuthors: string[];
  isbn: string | null;
  pages: number | null;
  publishedDate: string | null;
  publisher: string | null;
  summary: string | null;
  series: string | null;
  categories: string[];
  comments: string[];
  readingDates: string | null;
  read: boolean;
  inWishlist: boolean;
  amazonUrl: string | null;
  fnacUrl: string | null;
}

export interface MappedBook {
  isbn13: string | null;
  isbn10: string | null;
  title: string;
  subtitle: string | null;
  authors: string | null;
  publisher: string | null;
  publishedYear: number | null;
  pageCount: number | null;
  language: string | null;
  location: string | null;
  status: LibraryStatus;
  rating: number | null;
  notes: string | null;
}

/** Techo de `notes` en el esquema de validación. */
const MAX_NOTES = 4000;

const limpio = (value: string | null | undefined): string | null => {
  const text = (value ?? '').trim();
  return text.length ? text : null;
};

/**
 * Estado del libro.
 *
 * La lista de deseos manda sobre «leído»: en MyLibrary un libro puede estar en
 * la lista y marcado como leído a la vez, y lo que interesa saber es que
 * todavía no está en la estantería.
 */
export function mapStatus(book: Pick<MyLibraryBook, 'read' | 'inWishlist'>): LibraryStatus {
  if (book.inWishlist) return 'WISHLIST';
  return book.read ? 'READ' : 'OWNED';
}

/** Autor principal y secundarios, sin repetidos y sin huecos. */
export function joinAuthors(book: Pick<MyLibraryBook, 'author' | 'additionalAuthors'>): string | null {
  const todos = [book.author, ...book.additionalAuthors]
    .map((name) => limpio(name))
    .filter((name): name is string => Boolean(name));
  const unicos = [...new Set(todos)];
  return unicos.length ? unicos.join(', ').slice(0, 300) : null;
}

/**
 * Todo lo que no cabe en una columna, con su etiqueta.
 *
 * Si el ISBN de origen no es válido se anota también: perderlo en silencio
 * dejaría el libro sin rastro de por qué no tiene ISBN, y a veces es un número
 * bien escrito con un dígito mal tecleado que se puede arreglar a mano.
 */
export function composeNotes(book: MyLibraryBook, isbnValido: boolean): string | null {
  const secciones: string[] = [];
  const add = (etiqueta: string, valor: string | null) => {
    if (valor) secciones.push(`${etiqueta}: ${valor}`);
  };

  add('Resumen', limpio(book.summary));
  add('Serie', limpio(book.series));
  add('Categorías', book.categories.map(limpio).filter(Boolean).join(', ') || null);
  add('Fechas de lectura', limpio(book.readingDates));
  add('Comentarios', book.comments.map(limpio).filter(Boolean).join(' · ') || null);
  add('Amazon', limpio(book.amazonUrl));
  add('Fnac', limpio(book.fnacUrl));

  if (book.isbn && !isbnValido) add('ISBN de origen (no válido)', limpio(book.isbn));

  // Procedencia: dentro de un año, saber que una ficha vino de la importación
  // y con qué identificador explica cualquier rareza.
  secciones.push(`Importado de MyLibrary (id ${book.sourceId})`);

  const texto = secciones.join('\n');
  return texto.length > MAX_NOTES ? `${texto.slice(0, MAX_NOTES - 1)}…` : texto;
}

/**
 * Traduce una ficha. Devuelve `null` si no hay título: sin él no hay libro que
 * dar de alta, y el esquema lo rechazaría de todos modos.
 */
export function mapMyLibraryBook(book: MyLibraryBook): MappedBook | null {
  const title = limpio(book.title);
  if (!title) return null;

  // El ISBN se valida con su dígito de control: en un catálogo escrito a mano
  // hay números mal copiados, y guardarlos como buenos rompería el
  // antiduplicado y las búsquedas posteriores.
  const isbn = book.isbn ? parseIsbn(book.isbn) : null;

  return {
    isbn13: isbn?.isbn13 ?? null,
    isbn10: isbn?.isbn10 ?? null,
    title: title.slice(0, 300),
    subtitle: null,
    authors: joinAuthors(book),
    publisher: limpio(book.publisher)?.slice(0, 200) ?? null,
    publishedYear: extractYear(book.publishedDate),
    pageCount: book.pages && book.pages > 0 && book.pages <= 50_000 ? book.pages : null,
    language: null,
    location: null,
    status: mapStatus(book),
    rating: null,
    notes: composeNotes(book, Boolean(isbn)),
  };
}
