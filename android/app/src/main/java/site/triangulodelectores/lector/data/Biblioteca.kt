package site.triangulodelectores.lector.data

import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.OpenableColumns
import site.triangulodelectores.lector.data.local.Almacen
import site.triangulodelectores.lector.data.local.Anotacion
import site.triangulodelectores.lector.data.local.ColorAnotacion
import site.triangulodelectores.lector.data.local.Documento
import site.triangulodelectores.lector.data.local.Marcador
import site.triangulodelectores.lector.data.local.Origen
import site.triangulodelectores.lector.data.local.Progreso
import site.triangulodelectores.lector.data.local.Rect
import site.triangulodelectores.lector.data.local.TipoAnotacion
import site.triangulodelectores.lector.data.remote.Api
import java.io.File
import java.util.UUID

/**
 * La biblioteca del teléfono: lo que hay en el propio dispositivo y lo que baja
 * de la biblioteca privada, en una sola lista.
 *
 * Las dos mitades comparten tablas y pantallas, y se distinguen por `origen`.
 * Lo único que cambia es de dónde sale el fichero y si lo escrito encima viaja
 * o no al servidor: **lo de un PDF local no sale nunca del teléfono**.
 */
class Biblioteca(
    private val contexto: Context,
    private val almacen: Almacen,
    private val api: Api,
) {

    fun documentos(): List<Documento> = almacen.documentos()

    fun documento(id: String): Documento? = almacen.documento(id)

    fun progresos(): Map<String, Progreso> = almacen.progresos()

    // ------------------------------------------------ documentos del móvil --
    /**
     * Añade un PDF del teléfono.
     *
     * Se guarda la URI, no una copia: duplicar un libro de 40 MB en el
     * almacenamiento de la aplicación para leerlo es gastar el doble de espacio
     * a cambio de nada. Hace falta pedir permiso **persistente** sobre esa URI:
     * sin eso, al reiniciar el teléfono la aplicación deja de poder abrir su
     * propia estantería, que es el fallo clásico del selector de ficheros.
     *
     * Esto vale para el selector del sistema. Lo que llega de otra aplicación no
     * admite ese permiso y va por `importarEfimero()`, que sí copia.
     */
    fun importarLocal(uri: Uri): Documento {
        contexto.contentResolver.takePersistableUriPermission(
            uri,
            Intent.FLAG_GRANT_READ_URI_PERMISSION,
        )

        val yaEsta = almacen.documentos().firstOrNull { it.uri == uri.toString() }
        if (yaEsta != null) return yaEsta

        val (nombre, tamano) = datosDeUri(contexto.contentResolver, uri)
        val ahora = System.currentTimeMillis()
        val documento = Documento(
            id = UUID.randomUUID().toString(),
            origen = Origen.LOCAL,
            titulo = nombre.removeSuffix(".pdf").ifBlank { "Documento sin título" },
            autor = null,
            paginas = null,
            uri = uri.toString(),
            rutaFichero = null,
            tamanoBytes = tamano,
            checksum = null,
            creadoEn = ahora,
            actualizadoEn = ahora,
            leidoEn = null,
        )
        almacen.guardarDocumento(documento)
        return documento
    }

    /**
     * Documento que llega de otra aplicación: se **copia**, no se enlaza.
     *
     * Aquí no vale guardar la URI y ya está. La de un `ACTION_VIEW` es un
     * préstamo de un solo uso —no admite permiso persistente, pedirlo lanza— y
     * además WhatsApp y Telegram sirven el fichero desde una caché suya que
     * limpian cuando quieren. El resultado era que se abría bien y, al volver
     * del segundo plano un rato después, la aplicación decía que el documento
     * ya no estaba: la URI seguía guardada pero al otro lado no había nada.
     *
     * Copiarlo cuesta espacio —hasta cincuenta megas por documento—, y se paga
     * a propósito: es un fichero que llegó de fuera y del que nadie más se hace
     * cargo. El camino normal, `importarLocal()` con el selector del sistema, no
     * copia nada; ahí la URI sí es nuestra para siempre.
     *
     * Si la copia falla —sin espacio, o el origen se corta a medias— se guarda
     * la URI como antes: peor es no poder leerlo ahora.
     */
    fun importarEfimero(uri: Uri): Documento {
        val (nombre, tamano) = datosDeUri(contexto.contentResolver, uri)
        val titulo = nombre.removeSuffix(".pdf").ifBlank { "Documento sin título" }

        /*
         * El mismo fichero compartido dos veces llega con dos URI distintas, así
         * que no sirven para reconocerlo. Se compara por lo que sí se repite:
         * nombre y tamaño, y que la copia siga estando.
         */
        val yaEsta = almacen.documentos().firstOrNull { doc ->
            doc.origen == Origen.LOCAL &&
                doc.titulo == titulo &&
                doc.tamanoBytes == tamano &&
                doc.rutaFichero?.let { File(it).exists() } == true
        }
        if (yaEsta != null) return yaEsta

        val id = UUID.randomUUID().toString()
        val copia = runCatching { copiarAImportados(uri, id) }.getOrNull()

        val ahora = System.currentTimeMillis()
        val documento = Documento(
            id = id,
            origen = Origen.LOCAL,
            titulo = titulo,
            autor = null,
            paginas = null,
            // Con copia, la URI prestada deja de hacer falta y no se guarda: si
            // se guardara, sería una ruta muerta esperando a confundir a alguien.
            uri = if (copia == null) uri.toString() else null,
            rutaFichero = copia?.absolutePath,
            tamanoBytes = if (copia != null) copia.length() else tamano,
            checksum = null,
            creadoEn = ahora,
            actualizadoEn = ahora,
            leidoEn = null,
        )
        almacen.guardarDocumento(documento)
        return documento
    }

    /**
     * Trae el fichero al almacenamiento de la aplicación.
     *
     * Se escribe en un temporal y se renombra al final: si la copia se corta a
     * media —se acaba el espacio, el origen se cierra— no queda un PDF a medias
     * con pinta de bueno en la estantería.
     */
    private fun copiarAImportados(uri: Uri, id: String): File {
        val destino = File(carpetaImportados(), "$id.pdf")
        val temporal = File(carpetaImportados(), "$id.pdf.parcial")

        try {
            contexto.contentResolver.openInputStream(uri).use { entrada ->
                requireNotNull(entrada) { "No se ha podido leer el documento" }
                temporal.outputStream().use { salida -> entrada.copyTo(salida) }
            }
            if (temporal.length() <= 0L) throw IllegalStateException("El documento venía vacío")
            if (!temporal.renameTo(destino)) throw IllegalStateException("No se ha podido guardar la copia")
            return destino
        } catch (e: Throwable) {
            temporal.delete()
            throw e
        }
    }

    private fun carpetaImportados(): File =
        File(contexto.filesDir, "importados").apply { mkdirs() }

    /**
     * Quita un documento de la estantería.
     *
     * Un PDF local sólo se olvida -- el fichero es de quien lo tiene y no se
     * toca. De uno remoto se borra la copia descargada, pero no la ficha del
     * servidor: desde el teléfono se libera espacio, no se borra la biblioteca
     * de nadie.
     */
    fun quitar(documento: Documento) {
        if (documento.origen == Origen.LOCAL) {
            documento.uri?.let { uri ->
                runCatching {
                    contexto.contentResolver.releasePersistableUriPermission(
                        Uri.parse(uri),
                        Intent.FLAG_GRANT_READ_URI_PERMISSION,
                    )
                }
            }
            // La copia de lo que llegó de otra aplicación sí es nuestra y sí se
            // borra: si no, quitarlo de la estantería dejaría los megas dentro.
            documento.rutaFichero?.let { File(it).delete() }
            almacen.borrarDocumento(documento.id)
        } else {
            documento.rutaFichero?.let { File(it).delete() }
            almacen.anotarRutaFichero(documento.id, null)
        }
    }

    // ------------------------------------------------ documentos remotos --
    fun ficheroDe(documento: Documento): File =
        File(carpetaDescargas(), "${documento.id}.pdf")

    fun descargar(documento: Documento, alAvanzar: (Long, Long) -> Unit = { _, _ -> }): File {
        val destino = ficheroDe(documento)
        api.descargar(documento.id, destino, alAvanzar)
        almacen.anotarRutaFichero(documento.id, destino.absolutePath)
        return destino
    }

    private fun carpetaDescargas(): File =
        File(contexto.filesDir, "documentos").apply { mkdirs() }

    /**
     * El número de páginas lo cuenta el visor al abrir, igual que en el lector
     * web. Si el documento es de la biblioteca y el servidor todavía no lo
     * sabía, se le dice: así la ficha se completa se abra donde se abra.
     */
    fun anotarPaginas(documento: Documento, paginas: Int) {
        if (documento.paginas == paginas) return
        almacen.anotarPaginas(documento.id, paginas)
        if (documento.origen == Origen.REMOTO && documento.paginas == null) {
            runCatching { api.comunicarPaginas(documento.id, paginas) }
        }
    }

    // -------------------------------------------------------- lectura --
    fun progreso(documentoId: String): Progreso? = almacen.progreso(documentoId)

    fun guardarProgreso(documentoId: String, pagina: Int, scrollMilesimas: Int) {
        almacen.guardarProgreso(
            Progreso(
                documentoId = documentoId,
                pagina = pagina,
                scrollMilesimas = scrollMilesimas.coerceIn(0, 1000),
                actualizadoEn = System.currentTimeMillis(),
                pendiente = true,
            ),
        )
    }

    // ---------------------------------------------------- anotaciones --
    fun anotaciones(documentoId: String): List<Anotacion> = almacen.anotaciones(documentoId)

    /**
     * Guarda un subrayado.
     *
     * La cita llega vacía cuando se ha marcado una zona a mano, que es lo único
     * que se puede hacer en una página escaneada sin texto. Cuando hay capa de
     * texto llega escrita, y entonces el subrayado del teléfono guarda lo mismo
     * que el del navegador: dónde está y qué dice.
     */
    fun crearSubrayado(
        documentoId: String,
        pagina: Int,
        rects: List<Rect>,
        color: ColorAnotacion,
        cita: String? = null,
    ): Anotacion {
        val ahora = System.currentTimeMillis()
        val anotacion = Anotacion(
            id = UUID.randomUUID().toString(),
            documentoId = documentoId,
            tipo = TipoAnotacion.HIGHLIGHT,
            pagina = pagina,
            rects = rects,
            cita = cita?.trim()?.takeIf { it.isNotEmpty() },
            texto = null,
            color = color,
            creadoEn = ahora,
            actualizadoEn = ahora,
            borradoEn = null,
        )
        almacen.guardarAnotacion(anotacion)
        return anotacion
    }

    fun crearNota(documentoId: String, pagina: Int, texto: String, color: ColorAnotacion): Anotacion {
        val ahora = System.currentTimeMillis()
        val anotacion = Anotacion(
            id = UUID.randomUUID().toString(),
            documentoId = documentoId,
            tipo = TipoAnotacion.NOTE,
            pagina = pagina,
            rects = emptyList(),
            cita = null,
            texto = texto,
            color = color,
            creadoEn = ahora,
            actualizadoEn = ahora,
            borradoEn = null,
        )
        almacen.guardarAnotacion(anotacion)
        return anotacion
    }

    fun editarAnotacion(id: String, texto: String?, color: ColorAnotacion) {
        val actual = almacen.anotacion(id) ?: return
        almacen.guardarAnotacion(
            actual.copy(
                texto = texto,
                color = color,
                actualizadoEn = System.currentTimeMillis(),
                pendiente = true,
            ),
        )
    }

    /**
     * Borrado **lógico**, igual que en el servidor: se pone la lápida y se sube
     * como un cambio más. Borrar la fila aquí dejaría al servidor sin forma de
     * enterarse, y el subrayado volvería en la siguiente sincronización.
     */
    fun borrarAnotacion(id: String) {
        val actual = almacen.anotacion(id) ?: return
        val ahora = System.currentTimeMillis()
        almacen.guardarAnotacion(actual.copy(borradoEn = ahora, actualizadoEn = ahora, pendiente = true))
    }

    // ----------------------------------------------------- marcadores --
    fun marcadores(documentoId: String): List<Marcador> = almacen.marcadores(documentoId)

    /** Marca o desmarca la página. Devuelve si queda marcada. */
    fun alternarMarcador(documentoId: String, pagina: Int, etiqueta: String? = null): Boolean {
        val ahora = System.currentTimeMillis()
        val actual = almacen.marcador(documentoId, pagina)
        val marcada = actual == null || actual.borradoEn != null

        almacen.guardarMarcador(
            Marcador(
                id = actual?.id ?: UUID.randomUUID().toString(),
                documentoId = documentoId,
                pagina = pagina,
                etiqueta = etiqueta ?: actual?.etiqueta,
                creadoEn = actual?.creadoEn ?: ahora,
                actualizadoEn = ahora,
                borradoEn = if (marcada) null else ahora,
                pendiente = true,
            ),
        )
        return marcada
    }
}

/** Nombre y tamaño que declara el proveedor de la URI. */
private fun datosDeUri(resolver: ContentResolver, uri: Uri): Pair<String, Long> {
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
        ?.use { cursor ->
            if (cursor.moveToFirst()) {
                val nombre = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                    .let { if (it >= 0 && !cursor.isNull(it)) cursor.getString(it) else "" }
                val tamano = cursor.getColumnIndex(OpenableColumns.SIZE)
                    .let { if (it >= 0 && !cursor.isNull(it)) cursor.getLong(it) else 0L }
                return nombre to tamano
            }
        }
    return (uri.lastPathSegment ?: "Documento") to 0L
}
