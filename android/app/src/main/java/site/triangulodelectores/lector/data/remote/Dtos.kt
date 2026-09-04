package site.triangulodelectores.lector.data.remote

import kotlinx.serialization.Serializable

/**
 * Lo que viaja por la API del subdominio `books.`.
 *
 * Los nombres son los del servidor, sin traducir: cada renombrado sería un
 * sitio donde una respuesta deja de encajar sin que nada avise. Lo que se
 * traduce al castellano es el modelo de dentro (`data/local/Models.kt`), en la
 * frontera, y de una vez.
 */

@Serializable
data class ErrorApi(val code: String, val message: String)

@Serializable
data class UsuarioDto(val id: String, val displayName: String)

@Serializable
data class SesionDto(
    val token: String,
    val deviceId: String,
    val expiresAt: Long,
    val user: UsuarioDto,
    val serverTime: Long,
)

@Serializable
data class DocumentoDto(
    val id: String,
    val title: String,
    val author: String? = null,
    val sizeBytes: Long = 0,
    val checksum: String? = null,
    val pageCount: Int? = null,
    val notes: String? = null,
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
    val lastReadAt: Long? = null,
    val annotationCount: Int = 0,
    val progress: ProgresoDto? = null,
    val fileUrl: String,
    val coverUrl: String? = null,
)

@Serializable
data class ProgresoDto(val page: Int, val scrollPct: Int = 0)

@Serializable
data class ListaDocumentosDto(val documents: List<DocumentoDto>, val serverTime: Long)

@Serializable
data class DetalleDocumentoDto(
    val document: DocumentoDto,
    val annotations: List<AnotacionDto> = emptyList(),
    val bookmarks: List<MarcadorDto> = emptyList(),
    val serverTime: Long,
)

@Serializable
data class RectDto(val x: Float, val y: Float, val w: Float, val h: Float)

@Serializable
data class AnotacionDto(
    val id: String,
    val documentId: String,
    val kind: String,
    val page: Int,
    val rects: List<RectDto> = emptyList(),
    val quote: String? = null,
    val body: String? = null,
    val color: String = "YELLOW",
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long? = null,
)

@Serializable
data class MarcadorDto(
    val id: String,
    val documentId: String,
    val page: Int,
    val label: String? = null,
    val createdAt: Long,
    val updatedAt: Long,
    val deletedAt: Long? = null,
)

@Serializable
data class ProgresoSyncDto(
    val documentId: String,
    val page: Int,
    val scrollPct: Int,
    val updatedAt: Long,
)

/** Lo que sube el teléfono. Los tres lotes van juntos: es una sola vuelta. */
@Serializable
data class SubidaDto(
    val progress: List<ProgresoSyncDto> = emptyList(),
    val annotations: List<AnotacionDto> = emptyList(),
    val bookmarks: List<MarcadorDto> = emptyList(),
)

@Serializable
data class ResultadoSubidaDto(
    val serverTime: Long,
    val aplicados: Int = 0,
    val descartados: Int = 0,
    val desconocidos: Int = 0,
)

/**
 * `documentIds` viene entero y no sólo lo cambiado: es la única forma de
 * enterarse de un documento **borrado** en el servidor, porque esas fichas sí
 * se borran de verdad y no dejan lápida que mirar.
 */
@Serializable
data class BajadaDto(
    val serverTime: Long,
    val documentIds: List<String> = emptyList(),
    val documents: List<DocumentoDto> = emptyList(),
    val progress: List<ProgresoSyncDto> = emptyList(),
    val annotations: List<AnotacionDto> = emptyList(),
    val bookmarks: List<MarcadorDto> = emptyList(),
)

@Serializable
data class VersionDto(
    val version: String,
    val versionCode: Int,
    val sizeBytes: Long = 0,
    val sha256: String = "",
    val publishedAt: String = "",
    val minSdk: Int = 0,
    val notes: String? = null,
    val url: String = "",
)

// ------------------------------------------------------------ biblioteca --
/**
 * Una ficha del catálogo en papel.
 *
 * Es el mismo vocabulario que usa el servidor, sin traducir: cada traducción
 * entre modelos es un sitio donde perder un campo al añadirlo en un lado y
 * olvidarlo en el otro.
 */
@Serializable
data class LibroDto(
    val id: String,
    val isbn13: String? = null,
    val isbn10: String? = null,
    val title: String,
    val subtitle: String? = null,
    val authors: String? = null,
    val publisher: String? = null,
    val publishedYear: Int? = null,
    val pageCount: Int? = null,
    val language: String? = null,
    val location: String? = null,
    val status: String = "OWNED",
    val rating: Int? = null,
    val notes: String? = null,
    val source: String = "MANUAL",
    val createdAt: Long = 0,
    val updatedAt: Long = 0,
    /** Ruta relativa en la propia API, no una dirección de un tercero. */
    val coverUrl: String? = null,
)

@Serializable
data class ContadoresDto(
    val total: Int = 0,
    val owned: Int = 0,
    val reading: Int = 0,
    val read: Int = 0,
    val lent: Int = 0,
    val wishlist: Int = 0,
)

@Serializable
data class ListaBibliotecaDto(
    val books: List<LibroDto> = emptyList(),
    val counters: ContadoresDto = ContadoresDto(),
    val serverTime: Long = 0,
)

@Serializable
data class LibroEnvolturaDto(val book: LibroDto? = null)

/** Lo que Open Library sabe de un ISBN. Puede venir casi vacío. */
@Serializable
data class BorradorIsbnDto(
    val isbn13: String? = null,
    val isbn10: String? = null,
    val title: String = "",
    val subtitle: String? = null,
    val authors: String? = null,
    val publisher: String? = null,
    val publishedYear: Int? = null,
    val pageCount: Int? = null,
    val language: String? = null,
    val coverUrl: String? = null,
)

/** `existing` no es un error: dice que ese ISBN ya está en el catálogo. */
@Serializable
data class LibroExistenteDto(val id: String, val title: String)

@Serializable
data class RespuestaIsbnDto(
    val draft: BorradorIsbnDto? = null,
    val existing: LibroExistenteDto? = null,
)

/**
 * Lo que se envía al dar de alta o editar.
 *
 * **Los campos de texto van vacíos, nunca nulos.** El esquema del servidor los
 * declara opcionales, y «opcional» en Zod significa que puede faltar, no que
 * pueda valer `null`: un nulo explícito lo rechaza con un 400 sin más
 * explicación. La cadena vacía sí la entiende y la trata como «sin valor». Los
 * numéricos, en cambio, sí admiten nulo, que es como se dice «sin año».
 */
@Serializable
data class LibroEnvioDto(
    val title: String,
    val isbn13: String = "",
    val isbn10: String = "",
    val subtitle: String = "",
    val authors: String = "",
    val publisher: String = "",
    val publishedYear: Int? = null,
    val pageCount: Int? = null,
    val language: String = "",
    val location: String = "",
    val status: String = "OWNED",
    val rating: Int? = null,
    val notes: String = "",
    val coverKey: String = "",
    val coverUrl: String = "",
)

/** La ficha guardada, lista para volver a enviarse tal cual al editarla. */
fun LibroDto.paraEnviar(): LibroEnvioDto = LibroEnvioDto(
    title = title,
    isbn13 = isbn13.orEmpty(),
    isbn10 = isbn10.orEmpty(),
    subtitle = subtitle.orEmpty(),
    authors = authors.orEmpty(),
    publisher = publisher.orEmpty(),
    publishedYear = publishedYear,
    pageCount = pageCount,
    language = language.orEmpty(),
    location = location.orEmpty(),
    status = status,
    rating = rating,
    notes = notes.orEmpty(),
)

/** El borrador que devuelve la consulta por ISBN, listo para dar de alta. */
fun BorradorIsbnDto.paraEnviar(): LibroEnvioDto = LibroEnvioDto(
    title = title,
    isbn13 = isbn13.orEmpty(),
    isbn10 = isbn10.orEmpty(),
    subtitle = subtitle.orEmpty(),
    authors = authors.orEmpty(),
    publisher = publisher.orEmpty(),
    publishedYear = publishedYear,
    pageCount = pageCount,
    language = language.orEmpty(),
    coverUrl = coverUrl.orEmpty(),
)
