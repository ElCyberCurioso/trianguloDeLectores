/**
 * Año de publicación a partir de texto libre.
 *
 * Ni MyLibrary ni Open Library guardan la fecha como fecha: viene como la
 * escribió alguien —«1998», «12 de marzo de 1998», «c1998» por *circa*, o
 * vacío—. Esto sólo busca un año con pinta de serlo.
 *
 * Los delimitadores son de dígito y no de palabra: con `\b`, «c1998» no casaba
 * —entre una letra y un dígito no hay frontera de palabra— y esas fichas
 * perdían el año en silencio. Con `(?<!\d)` y `(?!\d)` se acepta «c1998» y se
 * sigue rechazando «19985», que no es un año sino otra cosa.
 */
export function extractYear(value: string | null | undefined): number | null {
  const text = (value ?? '').trim();
  if (!text) return null;

  const match = text.match(/(?<!\d)(1[4-9]\d{2}|20\d{2}|21\d{2})(?!\d)/);
  if (!match) return null;

  const year = Number(match[1]);
  return year >= 1400 && year <= 2200 ? year : null;
}

/**
 * Un periodo: cuándo empezó, cuándo acabó y si sigue.
 *
 * `year` es el principio y es el único campo indexado y ordenable —por eso se
 * queda con el nombre de siempre—. `yearEnd` nulo significa un solo año; nulo
 * con `yearOngoing` significa «hasta la actualidad», que no se guarda como el
 * año en curso porque eso obligaría a repasar la tabla cada enero.
 */
export interface YearRange {
  year: number | null;
  yearEnd: number | null;
  yearOngoing: boolean;
}

export const EMPTY_YEAR_RANGE: YearRange = { year: null, yearEnd: null, yearOngoing: false };

/**
 * Lo que se puede pintar como periodo.
 *
 * Más flexible que `YearRange` a propósito: quien llama suele ser una fila de
 * la base, y ahí `yearOngoing` es el 0 o el 1 de SQLite, no un booleano. Pedir
 * la conversión en cada sitio que pinta una fecha sería pedirla veinte veces.
 */
export interface YearRangeLike {
  year?: number | null;
  yearEnd?: number | null;
  yearOngoing?: boolean | number | null;
}

const ANIO_MIN = 1400;
const ANIO_MAX = 2200;

/**
 * Las palabras que significan «y sigue».
 *
 * Se escriben de muchas maneras y todas quieren decir lo mismo; un desplegable
 * con «¿sigue en emisión?» habría sido un campo más que rellenar para algo que
 * ya se dice escribiendo. Se comparan sin acentos, que es como se escriben a
 * toda prisa.
 */
const EN_CURSO = ['actualidad', 'actual', 'hoy', 'presente', 'ahora', 'emision', 'curso'];

/** Quita acentos para comparar. `NFD` separa la letra de su tilde. */
function sinAcentos(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function anioValido(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  return value >= ANIO_MIN && value <= ANIO_MAX ? value : null;
}

/**
 * De lo que se escribe en un campo a un periodo.
 *
 * Un campo de texto y no tres, porque así es como se dice: «2020-2022»,
 * «2023-actualidad», «1999». Partir eso en «desde», «hasta» y una casilla sería
 * pedir tres gestos para escribir una cosa, y en el noventa por ciento de las
 * fichas —una película, un libro— sólo hay un año que poner.
 *
 * Acepta el guion normal, la raya, la barra y la palabra «a» como separadores.
 * Lo que no entienda se queda en el primer año que encuentre, que es mejor que
 * rechazar la ficha entera por cómo se escribió una fecha.
 */
export function parseYearRange(value: string | null | undefined): YearRange {
  const texto = (value ?? '').trim();
  if (!texto) return { ...EMPTY_YEAR_RANGE };

  const normalizado = sinAcentos(texto);

  // El separador se busca **entre** los extremos, no al principio: «-1999» no
  // es un periodo abierto por la izquierda, es un año mal escrito.
  const partes = normalizado.split(/\s*(?:-|–|—|\/|\ba\b|\bhasta\b)\s*/).filter((p) => p.length);

  const desde = anioValido(extractYear(partes[0] ?? normalizado));
  if (desde === null) return { ...EMPTY_YEAR_RANGE };

  const resto = partes.slice(1).join(' ').trim();

  // «2020-» y «desde 2020» también dicen que sigue: el periodo se abrió y no se
  // cerró. Lo dice el separador, que ya se ha consumido al partir.
  const abierto = /[-–—/]\s*$/.test(normalizado) || /\bdesde\b/.test(normalizado);

  if (!resto) {
    return { year: desde, yearEnd: null, yearOngoing: abierto };
  }

  if (EN_CURSO.some((palabra) => resto.includes(palabra))) {
    return { year: desde, yearEnd: null, yearOngoing: true };
  }

  const hasta = anioValido(extractYear(resto));
  if (hasta === null) return { year: desde, yearEnd: null, yearOngoing: abierto };

  // Escrito al revés se endereza en vez de rechazarse: «2022-2020» es un dedo
  // que se ha adelantado, no un periodo imposible.
  const [inicio, fin] = hasta < desde ? [hasta, desde] : [desde, hasta];
  return { year: inicio, yearEnd: fin === inicio ? null : fin, yearOngoing: false };
}

/**
 * El periodo tal como se pinta, con **raya** y no con guion: es un rango, y la
 * raya es lo que usa el kit para los rangos. Devuelve `null` cuando no hay año,
 * para que quien lo pinta no tenga que decidir si enseñar un hueco.
 */
export function formatYearRange(range: YearRangeLike | null | undefined): string | null {
  const desde = anioValido(range?.year ?? null);
  if (desde === null) return null;
  if (range?.yearOngoing) return `${desde}–actualidad`;

  const hasta = anioValido(range?.yearEnd ?? null);
  if (hasta === null || hasta === desde) return String(desde);
  return `${desde}–${hasta}`;
}

/**
 * El periodo tal como se vuelve a escribir en el formulario.
 *
 * Tiene que poder volver a pasar por `parseYearRange()` sin perder nada: el
 * formulario de edición se rellena con esto, y si al guardar sin tocar nada el
 * periodo cambiara, editar el título rompería la fecha.
 */
export function yearRangeToInput(range: YearRangeLike | null | undefined): string {
  const desde = anioValido(range?.year ?? null);
  if (desde === null) return '';
  if (range?.yearOngoing) return `${desde}-actualidad`;

  const hasta = anioValido(range?.yearEnd ?? null);
  if (hasta === null || hasta === desde) return String(desde);
  return `${desde}-${hasta}`;
}
