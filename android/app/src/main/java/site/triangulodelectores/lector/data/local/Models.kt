package site.triangulodelectores.lector.data.local

/**
 * Modelo de datos de la aplicación.
 *
 * Es deliberadamente el mismo que el del servidor -- páginas, milésimas de
 * scroll, rectángulos normalizados 0..1, colores por nombre -- porque los dos
 * lados escriben sobre lo mismo. Cada traducción entre modelos habría sido un
 * sitio donde perder precisión al sincronizar.
 */

enum class Origen {
    /** PDF del propio teléfono, abierto con el selector del sistema. */
    LOCAL,

    /** PDF de la biblioteca privada. Es el único que se sincroniza. */
    REMOTO,
}

data class Documento(
    val id: String,
    val origen: Origen,
    val titulo: String,
    val autor: String?,
    val paginas: Int?,
    /** URI del sistema de ficheros del teléfono. Sólo en los locales. */
    val uri: String?,
    /** Copia descargada en el almacenamiento de la aplicación. Sólo en los remotos. */
    val rutaFichero: String?,
    val tamanoBytes: Long,
    val checksum: String?,
    val creadoEn: Long,
    val actualizadoEn: Long,
    val leidoEn: Long?,
) {
    /** ¿Se puede abrir ahora mismo, sin red? */
    val disponible: Boolean
        get() = when (origen) {
            Origen.LOCAL -> uri != null
            Origen.REMOTO -> rutaFichero != null
        }
}

data class Progreso(
    val documentoId: String,
    val pagina: Int,
    /** Fracción de la página visible arriba, en milésimas (0..1000). */
    val scrollMilesimas: Int,
    val actualizadoEn: Long,
    /** Pendiente de subir al servidor. */
    val pendiente: Boolean = true,
)

enum class TipoAnotacion { HIGHLIGHT, NOTE }

enum class ColorAnotacion { YELLOW, RED, GREEN, BLUE }

/** Rectángulo normalizado al tamaño de la página: cae en su sitio con cualquier zoom. */
data class Rect(val x: Float, val y: Float, val w: Float, val h: Float)

data class Anotacion(
    val id: String,
    val documentoId: String,
    val tipo: TipoAnotacion,
    val pagina: Int,
    val rects: List<Rect>,
    /**
     * Texto citado. En el lector web lo rellena la capa de texto de pdf.js.
     * Aquí es siempre `null`: `PdfRenderer` pinta la página como imagen y no
     * expone el texto, así que un subrayado del móvil marca una zona, no unas
     * palabras. Se guarda igual y viaja al servidor con el mismo formato.
     */
    val cita: String?,
    val texto: String?,
    val color: ColorAnotacion,
    val creadoEn: Long,
    val actualizadoEn: Long,
    val borradoEn: Long?,
    val pendiente: Boolean = true,
)

data class Marcador(
    val id: String,
    val documentoId: String,
    val pagina: Int,
    val etiqueta: String?,
    val creadoEn: Long,
    val actualizadoEn: Long,
    val borradoEn: Long?,
    val pendiente: Boolean = true,
)
