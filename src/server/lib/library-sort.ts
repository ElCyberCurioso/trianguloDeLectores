import type { LibraryRecord, LibraryStatus } from '../../db/repos/library';
import { LIBRARY_SORTS, LIBRARY_SORT_DEFAULT, type LibrarySort } from '../../types/domain';

export { LIBRARY_SORTS, LIBRARY_SORT_DEFAULT, type LibrarySort };

/**
 * Ordenación del catálogo.
 *
 * Se hace aquí y no en SQL por dos motivos:
 *
 *   - **SQLite no sabe ordenar en español.** Compara códigos de carácter, así
 *     que «Álvarez» acaba detrás de «Zapata» y «cerdo» detrás de «Zurich».
 *     `Intl.Collator` sí, y en el runtime está disponible con ICU completo.
 *   - **El apellido no es una columna.** `authors` es un texto con los autores
 *     separados por coma («Isaac Asimov»), tal y como venía del catálogo de
 *     origen, y el apellido hay que derivarlo.
 *
 * El coste es irrelevante: la lista ya se traía entera —son cientos de fichas,
 * no cientos de miles— y ordenar en memoria no cambia el número de lecturas.
 */

const colador = new Intl.Collator('es', { sensitivity: 'base', numeric: true, ignorePunctuation: true });

/** El primero de la lista es el de por omisión: encabeza el desplegable. */
export const LIBRARY_SORT_LABELS: Record<LibrarySort, string> = {
  apellido: 'Apellido del autor (A–Z)',
  titulo: 'Título (A–Z)',
  nombre: 'Nombre del autor (A–Z)',
  recientes: 'Añadido recientemente',
  'anyo-desc': 'Publicación (más reciente)',
  'anyo-asc': 'Publicación (más antigua)',
  'paginas-desc': 'Páginas (más largo)',
  'paginas-asc': 'Páginas (más corto)',
  estado: 'Estado',
  nota: 'Nota (mejor primero)',
};

/**
 * Partículas que no encabezan un apellido al ordenar.
 *
 * «Miguel de Cervantes» se busca por la C, no por la D. Se quitan sólo al
 * principio del apellido: «Rodríguez de la Fuente» conserva su interior.
 */
const PARTICULAS = new Set(['de', 'del', 'la', 'las', 'los', 'van', 'von', 'da', 'di', 'du', 'le', 'el', "d'", 'mac', 'mc']);

/** El primero de los autores. Es por el que se ordena cuando hay varios. */
function primerAutor(authors: string | null): string {
  return (authors ?? '').split(',')[0]?.trim() ?? '';
}

/**
 * Apellido con el que se archiva un autor.
 *
 * Heurística, porque de un texto suelto no se puede saber con certeza: **el
 * nombre de pila es la primera palabra y el apellido es el resto**, quitando
 * las partículas iniciales. Con eso:
 *
 *   «Isaac Asimov»            → Asimov
 *   «Gabriel García Márquez»  → García Márquez   (el primer apellido manda,
 *                                                 que es como se ordena aquí)
 *   «Miguel de Cervantes»     → Cervantes
 *
 * Un autor de una sola palabra («Homero») se archiva por ella.
 */
export function surnameKey(authors: string | null): string {
  const partes = primerAutor(authors).split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return partes[0] ?? '';

  const resto = partes.slice(1);
  while (resto.length > 1 && PARTICULAS.has(resto[0]!.toLowerCase())) resto.shift();
  return resto.join(' ');
}

/** Nombre de pila: la primera palabra del primer autor. */
export function givenKey(authors: string | null): string {
  return primerAutor(authors).split(/\s+/)[0] ?? '';
}

/**
 * Compara dos valores que pueden faltar.
 *
 * Lo que no tiene dato va **siempre al final**, se ordene ascendente o
 * descendente: 137 de las 229 fichas no traen año, y verlas primero al pedir
 * «más reciente» no sería ordenar, sería esconder el catálogo.
 */
function compararNumeros(a: number | null, b: number | null, descendente: boolean): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return descendente ? b - a : a - b;
}

/** Orden de los estados: primero lo que se está leyendo, al final lo que no se tiene. */
const ORDEN_ESTADO: Record<LibraryStatus, number> = {
  READING: 0,
  OWNED: 1,
  READ: 2,
  LENT: 3,
  WISHLIST: 4,
};

const porTitulo = (a: LibraryRecord, b: LibraryRecord) => colador.compare(a.title, b.title);

const COMPARADORES: Record<LibrarySort, (a: LibraryRecord, b: LibraryRecord) => number> = {
  recientes: (a, b) => b.createdAt - a.createdAt,
  titulo: porTitulo,
  apellido: (a, b) => colador.compare(surnameKey(a.authors), surnameKey(b.authors)) || porTitulo(a, b),
  nombre: (a, b) => colador.compare(givenKey(a.authors), givenKey(b.authors)) || porTitulo(a, b),
  'anyo-desc': (a, b) => compararNumeros(a.publishedYear, b.publishedYear, true) || porTitulo(a, b),
  'anyo-asc': (a, b) => compararNumeros(a.publishedYear, b.publishedYear, false) || porTitulo(a, b),
  'paginas-desc': (a, b) => compararNumeros(a.pageCount, b.pageCount, true) || porTitulo(a, b),
  'paginas-asc': (a, b) => compararNumeros(a.pageCount, b.pageCount, false) || porTitulo(a, b),
  estado: (a, b) => ORDEN_ESTADO[a.status] - ORDEN_ESTADO[b.status] || porTitulo(a, b),
  nota: (a, b) => compararNumeros(a.rating, b.rating, true) || porTitulo(a, b),
};

/**
 * Ordena una copia, nunca el array recibido. Todos los criterios desempatan por
 * título: sin eso, dos libros del mismo autor o del mismo año cambiarían de
 * sitio entre recargas y la lista parecería inestable.
 */
export function sortLibrary(books: LibraryRecord[], sort: LibrarySort): LibraryRecord[] {
  return [...books].sort(COMPARADORES[sort] ?? COMPARADORES[LIBRARY_SORT_DEFAULT]);
}
