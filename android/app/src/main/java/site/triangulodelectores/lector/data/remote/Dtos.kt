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
