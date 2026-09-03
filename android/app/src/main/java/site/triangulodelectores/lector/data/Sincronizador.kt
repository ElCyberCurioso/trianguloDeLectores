package site.triangulodelectores.lector.data

import site.triangulodelectores.lector.data.local.Ajustes
import site.triangulodelectores.lector.data.local.Almacen
import site.triangulodelectores.lector.data.local.Anotacion
import site.triangulodelectores.lector.data.local.ColorAnotacion
import site.triangulodelectores.lector.data.local.Credenciales
import site.triangulodelectores.lector.data.local.Documento
import site.triangulodelectores.lector.data.local.Marcador
import site.triangulodelectores.lector.data.local.Origen
import site.triangulodelectores.lector.data.local.Progreso
import site.triangulodelectores.lector.data.local.Rect
import site.triangulodelectores.lector.data.local.TipoAnotacion
import site.triangulodelectores.lector.data.remote.AnotacionDto
import site.triangulodelectores.lector.data.remote.Api
import site.triangulodelectores.lector.data.remote.DocumentoDto
import site.triangulodelectores.lector.data.remote.FalloApi
import site.triangulodelectores.lector.data.remote.MarcadorDto
import site.triangulodelectores.lector.data.remote.ProgresoSyncDto
import site.triangulodelectores.lector.data.remote.RectDto
import site.triangulodelectores.lector.data.remote.SubidaDto
import java.io.File

/**
 * Sincronización con la biblioteca privada.
 *
 * El orden es **subir y luego bajar**, y no al revés: bajando primero, lo que
 * el servidor tiene sobrescribiría en local cambios que aún no se han enviado,
 * y se perderían sin dejar rastro. Subiendo primero, el servidor resuelve el
 * conflicto con la regla de siempre —gana la escritura más reciente— y lo que
 * baja después ya es el resultado acordado.
 *
 * La marca de agua (`serverTime`) la pone el servidor. El reloj del teléfono no
 * decide nada aquí: puede ir minutos desviado, y con él como referencia se
 * perderían cambios enteros en cada vuelta.
 */
class Sincronizador(
    private val almacen: Almacen,
    private val api: Api,
    private val credenciales: Credenciales,
    private val ajustes: Ajustes,
) {

    data class Resultado(
        val subidos: Int,
        val bajados: Int,
        val descartados: Int,
        val documentos: Int,
    )

    /** Se lanza cuando el servidor ya no reconoce la credencial del teléfono. */
    class CredencialCaducada : Exception("Hay que volver a emparejar este teléfono")

    fun sincronizar(): Resultado {
        if (!credenciales.emparejado) return Resultado(0, 0, 0, 0)

        try {
            val subidos = subir()
            val bajada = bajar()
            ajustes.ultimaSincronizacion = System.currentTimeMillis()
            return Resultado(
                subidos = subidos,
                bajados = bajada.first,
                descartados = bajada.second,
                documentos = bajada.third,
            )
        } catch (e: FalloApi.Credencial) {
            // El token ya no vale: se olvida aquí mismo para que la aplicación
            // pida emparejar de nuevo en vez de reintentar en bucle contra un
            // 401. Lo leído en local no se toca.
            credenciales.olvidar()
            throw CredencialCaducada()
        }
    }

    // ------------------------------------------------------------- subida --
    private fun subir(): Int {
        val progresos = almacen.progresoPendiente()
        val anotaciones = almacen.anotacionesPendientes()
        val marcadores = almacen.marcadoresPendientes()

        if (progresos.isEmpty() && anotaciones.isEmpty() && marcadores.isEmpty()) return 0

        // Los topes del servidor son 200 progresos y 500 de cada lista. Se
        // trocea aquí para que volver de un mes sin red no sea un 400.
        var enviados = 0
        val lotesProgreso = progresos.chunked(200).ifEmpty { listOf(emptyList()) }
        val lotesAnotaciones = anotaciones.chunked(500).ifEmpty { listOf(emptyList()) }
        val lotesMarcadores = marcadores.chunked(500).ifEmpty { listOf(emptyList()) }
        val vueltas = maxOf(lotesProgreso.size, lotesAnotaciones.size, lotesMarcadores.size)

        for (i in 0 until vueltas) {
            val loteProgreso = lotesProgreso.getOrElse(i) { emptyList() }
            val loteAnotaciones = lotesAnotaciones.getOrElse(i) { emptyList() }
            val loteMarcadores = lotesMarcadores.getOrElse(i) { emptyList() }
            if (loteProgreso.isEmpty() && loteAnotaciones.isEmpty() && loteMarcadores.isEmpty()) continue

            api.subir(
                SubidaDto(
                    progress = loteProgreso.map {
                        ProgresoSyncDto(it.documentoId, it.pagina, it.scrollMilesimas, it.actualizadoEn)
                    },
                    annotations = loteAnotaciones.map(::aDto),
                    bookmarks = loteMarcadores.map(::aDto),
                ),
            )

            /*
             * Se marca como enviado todo el lote, incluido lo que el servidor
             * haya descartado por ser más viejo que lo suyo. Es justo lo que se
             * quiere: descartado significa que allí hay algo más reciente, y en
             * la bajada de dentro de un momento llegará. Reintentarlo para
             * siempre sería quedarse en bucle enviando lo que nunca va a ganar.
             */
            almacen.marcarSincronizado(
                loteProgreso.map { it.documentoId },
                loteAnotaciones.map { it.id },
                loteMarcadores.map { it.id },
            )
            enviados += loteProgreso.size + loteAnotaciones.size + loteMarcadores.size
        }
        return enviados
    }

    // ------------------------------------------------------------- bajada --
    private fun bajar(): Triple<Int, Int, Int> {
        val bajada = api.bajar(ajustes.marcaSincronizacion)
        var aplicados = 0
        var descartados = 0

        almacen.enTransaccion {
            // 1. Fichas. Lo que el servidor ya no tiene se va de la estantería,
            //    junto con su copia descargada: dejarla sería ocupar sitio por
            //    un libro que ya no existe en ninguna parte.
            val idsServidor = bajada.documentIds.toSet()
            if (idsServidor.isNotEmpty() || bajada.documents.isNotEmpty()) {
                almacen.idsRemotos().filterNot { idsServidor.contains(it) }.forEach { id ->
                    almacen.documento(id)?.rutaFichero?.let { File(it).delete() }
                    almacen.borrarDocumento(id)
                }
            }

            bajada.documents.forEach { dto ->
                val existente = almacen.documento(dto.id)
                almacen.guardarDocumento(aDocumento(dto, existente))
            }

            // 2. Progreso, anotaciones y marcadores: gana lo más reciente. Lo
            //    que sigue pendiente de subir aquí no se pisa, porque lo que
            //    llega es de antes de esta misma vuelta.
            bajada.progress.forEach { dto ->
                val local = almacen.progreso(dto.documentId)
                if (local == null || dto.updatedAt > local.actualizadoEn) {
                    almacen.guardarProgreso(
                        Progreso(dto.documentId, dto.page, dto.scrollPct, dto.updatedAt, pendiente = false),
                    )
                    aplicados++
                } else {
                    descartados++
                }
            }

            bajada.annotations.forEach { dto ->
                val local = almacen.anotacion(dto.id)
                if (local == null || dto.updatedAt > local.actualizadoEn) {
                    almacen.guardarAnotacion(aAnotacion(dto))
                    aplicados++
                } else {
                    descartados++
                }
            }

            bajada.bookmarks.forEach { dto ->
                val local = almacen.marcador(dto.documentId, dto.page)
                if (local == null || dto.updatedAt > local.actualizadoEn) {
                    almacen.guardarMarcador(aMarcador(dto))
                    aplicados++
                } else {
                    descartados++
                }
            }
        }

        ajustes.marcaSincronizacion = bajada.serverTime
        return Triple(aplicados, descartados, bajada.documents.size)
    }
}

// =============================================================== traducción ==
// Las dos formas del mismo dato se convierten aquí y sólo aquí: es la frontera
// entre el vocabulario del servidor (inglés, el de la API) y el de dentro.

private fun aDto(a: Anotacion) = AnotacionDto(
    id = a.id,
    documentId = a.documentoId,
    kind = a.tipo.name,
    page = a.pagina,
    rects = a.rects.map { RectDto(it.x, it.y, it.w, it.h) },
    quote = a.cita,
    body = a.texto,
    color = a.color.name,
    createdAt = a.creadoEn,
    updatedAt = a.actualizadoEn,
    deletedAt = a.borradoEn,
)

private fun aDto(m: Marcador) = MarcadorDto(
    id = m.id,
    documentId = m.documentoId,
    page = m.pagina,
    label = m.etiqueta,
    createdAt = m.creadoEn,
    updatedAt = m.actualizadoEn,
    deletedAt = m.borradoEn,
)

private fun aAnotacion(dto: AnotacionDto) = Anotacion(
    id = dto.id,
    documentoId = dto.documentId,
    tipo = runCatching { TipoAnotacion.valueOf(dto.kind) }.getOrDefault(TipoAnotacion.NOTE),
    pagina = dto.page,
    rects = dto.rects.map { Rect(it.x, it.y, it.w, it.h) },
    cita = dto.quote,
    texto = dto.body,
    color = runCatching { ColorAnotacion.valueOf(dto.color) }.getOrDefault(ColorAnotacion.YELLOW),
    creadoEn = dto.createdAt,
    actualizadoEn = dto.updatedAt,
    borradoEn = dto.deletedAt,
    pendiente = false,
)

private fun aMarcador(dto: MarcadorDto) = Marcador(
    id = dto.id,
    documentoId = dto.documentId,
    pagina = dto.page,
    etiqueta = dto.label,
    creadoEn = dto.createdAt,
    actualizadoEn = dto.updatedAt,
    borradoEn = dto.deletedAt,
    pendiente = false,
)

/**
 * La ficha que baja no sabe nada de la copia descargada: esa ruta es del
 * teléfono. Si se sobrescribiera con `null` en cada sincronización, el libro
 * descargado dejaría de poder abrirse sin red.
 */
private fun aDocumento(dto: DocumentoDto, existente: Documento?) = Documento(
    id = dto.id,
    origen = Origen.REMOTO,
    titulo = dto.title,
    autor = dto.author,
    paginas = dto.pageCount ?: existente?.paginas,
    uri = null,
    rutaFichero = existente?.rutaFichero,
    tamanoBytes = dto.sizeBytes,
    checksum = dto.checksum,
    creadoEn = dto.createdAt,
    actualizadoEn = dto.updatedAt,
    leidoEn = dto.lastReadAt ?: existente?.leidoEn,
)
