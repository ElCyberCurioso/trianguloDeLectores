package site.triangulodelectores.lector.data.local

import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONArray
import org.json.JSONObject

/**
 * Base de datos local.
 *
 * SQLite a pelo, sin ORM. El servidor tiene el SQL en `migrations/` y aquí
 * pasa lo mismo: el esquema se lee entero de un vistazo, las consultas son las
 * que son y no hay una capa que decida por su cuenta cuándo escribir. Para seis
 * tablas y una veintena de consultas, un ORM sólo habría añadido peso al APK y
 * un procesador de anotaciones al build.
 *
 * Las fechas son milisegundos desde época, como en el servidor. Los booleanos
 * son 0/1, que es lo que SQLite entiende.
 */
class BaseDatos(context: Context) : SQLiteOpenHelper(context, NOMBRE, null, VERSION) {

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """
            CREATE TABLE documentos (
              id             TEXT PRIMARY KEY,
              origen         TEXT NOT NULL,
              titulo         TEXT NOT NULL,
              autor          TEXT,
              paginas        INTEGER,
              uri            TEXT,
              ruta_fichero   TEXT,
              tamano_bytes   INTEGER NOT NULL DEFAULT 0,
              checksum       TEXT,
              creado_en      INTEGER NOT NULL,
              actualizado_en INTEGER NOT NULL,
              leido_en       INTEGER
            )
            """.trimIndent(),
        )
        db.execSQL("CREATE INDEX idx_documentos_recientes ON documentos (leido_en DESC, creado_en DESC)")

        db.execSQL(
            """
            CREATE TABLE progreso (
              documento_id   TEXT PRIMARY KEY REFERENCES documentos(id) ON DELETE CASCADE,
              pagina         INTEGER NOT NULL,
              scroll_milesimas INTEGER NOT NULL DEFAULT 0,
              actualizado_en INTEGER NOT NULL,
              pendiente      INTEGER NOT NULL DEFAULT 1
            )
            """.trimIndent(),
        )

        db.execSQL(
            """
            CREATE TABLE anotaciones (
              id             TEXT PRIMARY KEY,
              documento_id   TEXT NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
              tipo           TEXT NOT NULL,
              pagina         INTEGER NOT NULL,
              rects          TEXT,
              cita           TEXT,
              texto          TEXT,
              color          TEXT NOT NULL DEFAULT 'YELLOW',
              creado_en      INTEGER NOT NULL,
              actualizado_en INTEGER NOT NULL,
              borrado_en     INTEGER,
              pendiente      INTEGER NOT NULL DEFAULT 1
            )
            """.trimIndent(),
        )
        db.execSQL("CREATE INDEX idx_anotaciones_doc ON anotaciones (documento_id, pagina)")

        db.execSQL(
            """
            CREATE TABLE marcadores (
              id             TEXT PRIMARY KEY,
              documento_id   TEXT NOT NULL REFERENCES documentos(id) ON DELETE CASCADE,
              pagina         INTEGER NOT NULL,
              etiqueta       TEXT,
              creado_en      INTEGER NOT NULL,
              actualizado_en INTEGER NOT NULL,
              borrado_en     INTEGER,
              pendiente      INTEGER NOT NULL DEFAULT 1
            )
            """.trimIndent(),
        )
        db.execSQL("CREATE UNIQUE INDEX idx_marcadores_doc_pagina ON marcadores (documento_id, pagina)")
    }

    override fun onConfigure(db: SQLiteDatabase) {
        // Las claves ajenas no están activadas por omisión en SQLite: sin esto,
        // borrar un documento dejaría sus anotaciones huérfanas para siempre.
        db.setForeignKeyConstraintsEnabled(true)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        // Todavía no hay ninguna versión anterior publicada. Cuando la haya, el
        // camino es el mismo que en el servidor: cambios aditivos, nunca borrar
        // una columna con datos de alguien dentro.
    }

    companion object {
        private const val NOMBRE = "triangulo.db"
        private const val VERSION = 1
    }
}

// ============================================================== consultas ====

/**
 * Acceso a los datos. Todas las consultas viven aquí, igual que en el servidor
 * viven sólo en `src/db/repos`: ninguna pantalla escribe SQL.
 */
class Almacen(private val helper: BaseDatos) {

    // ------------------------------------------------------- documentos --
    fun documentos(): List<Documento> = helper.readableDatabase.rawQuery(
        "SELECT * FROM documentos ORDER BY leido_en IS NULL, leido_en DESC, creado_en DESC",
        null,
    ).use { it.mapear(::documentoDe) }

    fun documento(id: String): Documento? = helper.readableDatabase
        .rawQuery("SELECT * FROM documentos WHERE id = ?", arrayOf(id))
        .use { if (it.moveToFirst()) documentoDe(it) else null }

    fun guardarDocumento(documento: Documento) {
        val valores = ContentValues().apply {
            put("id", documento.id)
            put("origen", documento.origen.name)
            put("titulo", documento.titulo)
            put("autor", documento.autor)
            put("paginas", documento.paginas)
            put("uri", documento.uri)
            put("ruta_fichero", documento.rutaFichero)
            put("tamano_bytes", documento.tamanoBytes)
            put("checksum", documento.checksum)
            put("creado_en", documento.creadoEn)
            put("actualizado_en", documento.actualizadoEn)
            put("leido_en", documento.leidoEn)
        }
        helper.writableDatabase.insertWithOnConflict("documentos", null, valores, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun borrarDocumento(id: String) {
        helper.writableDatabase.delete("documentos", "id = ?", arrayOf(id))
    }

    fun idsRemotos(): Set<String> = helper.readableDatabase
        .rawQuery("SELECT id FROM documentos WHERE origen = 'REMOTO'", null)
        .use { cursor ->
            buildSet { while (cursor.moveToNext()) add(cursor.getString(0)) }
        }

    fun anotarRutaFichero(id: String, ruta: String?) {
        helper.writableDatabase.execSQL("UPDATE documentos SET ruta_fichero = ? WHERE id = ?", arrayOf(ruta, id))
    }

    fun anotarPaginas(id: String, paginas: Int) {
        helper.writableDatabase.execSQL("UPDATE documentos SET paginas = ? WHERE id = ?", arrayOf(paginas, id))
    }

    // --------------------------------------------------------- progreso --
    fun progreso(documentoId: String): Progreso? = helper.readableDatabase
        .rawQuery("SELECT * FROM progreso WHERE documento_id = ?", arrayOf(documentoId))
        .use { if (it.moveToFirst()) progresoDe(it) else null }

    fun progresos(): Map<String, Progreso> = helper.readableDatabase
        .rawQuery("SELECT * FROM progreso", null)
        .use { it.mapear(::progresoDe) }
        .associateBy { it.documentoId }

    fun guardarProgreso(progreso: Progreso) {
        val valores = ContentValues().apply {
            put("documento_id", progreso.documentoId)
            put("pagina", progreso.pagina)
            put("scroll_milesimas", progreso.scrollMilesimas)
            put("actualizado_en", progreso.actualizadoEn)
            put("pendiente", if (progreso.pendiente) 1 else 0)
        }
        helper.writableDatabase.insertWithOnConflict("progreso", null, valores, SQLiteDatabase.CONFLICT_REPLACE)
        helper.writableDatabase.execSQL(
            "UPDATE documentos SET leido_en = ? WHERE id = ? AND (leido_en IS NULL OR leido_en < ?)",
            arrayOf(progreso.actualizadoEn, progreso.documentoId, progreso.actualizadoEn),
        )
    }

    fun progresoPendiente(): List<Progreso> = helper.readableDatabase.rawQuery(
        """
        SELECT p.* FROM progreso p
        JOIN documentos d ON d.id = p.documento_id
        WHERE p.pendiente = 1 AND d.origen = 'REMOTO'
        """.trimIndent(),
        null,
    ).use { it.mapear(::progresoDe) }

    // ------------------------------------------------------ anotaciones --
    fun anotaciones(documentoId: String): List<Anotacion> = helper.readableDatabase.rawQuery(
        "SELECT * FROM anotaciones WHERE documento_id = ? AND borrado_en IS NULL ORDER BY pagina, creado_en",
        arrayOf(documentoId),
    ).use { it.mapear(::anotacionDe) }

    fun guardarAnotacion(anotacion: Anotacion) {
        val valores = ContentValues().apply {
            put("id", anotacion.id)
            put("documento_id", anotacion.documentoId)
            put("tipo", anotacion.tipo.name)
            put("pagina", anotacion.pagina)
            put("rects", rectsAJson(anotacion.rects))
            put("cita", anotacion.cita)
            put("texto", anotacion.texto)
            put("color", anotacion.color.name)
            put("creado_en", anotacion.creadoEn)
            put("actualizado_en", anotacion.actualizadoEn)
            put("borrado_en", anotacion.borradoEn)
            put("pendiente", if (anotacion.pendiente) 1 else 0)
        }
        helper.writableDatabase.insertWithOnConflict("anotaciones", null, valores, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun anotacion(id: String): Anotacion? = helper.readableDatabase
        .rawQuery("SELECT * FROM anotaciones WHERE id = ?", arrayOf(id))
        .use { if (it.moveToFirst()) anotacionDe(it) else null }

    fun anotacionesPendientes(): List<Anotacion> = helper.readableDatabase.rawQuery(
        """
        SELECT a.* FROM anotaciones a
        JOIN documentos d ON d.id = a.documento_id
        WHERE a.pendiente = 1 AND d.origen = 'REMOTO'
        """.trimIndent(),
        null,
    ).use { it.mapear(::anotacionDe) }

    // ------------------------------------------------------- marcadores --
    fun marcadores(documentoId: String): List<Marcador> = helper.readableDatabase.rawQuery(
        "SELECT * FROM marcadores WHERE documento_id = ? AND borrado_en IS NULL ORDER BY pagina",
        arrayOf(documentoId),
    ).use { it.mapear(::marcadorDe) }

    fun marcador(documentoId: String, pagina: Int): Marcador? = helper.readableDatabase
        .rawQuery("SELECT * FROM marcadores WHERE documento_id = ? AND pagina = ?", arrayOf(documentoId, pagina.toString()))
        .use { if (it.moveToFirst()) marcadorDe(it) else null }

    fun guardarMarcador(marcador: Marcador) {
        val valores = ContentValues().apply {
            put("id", marcador.id)
            put("documento_id", marcador.documentoId)
            put("pagina", marcador.pagina)
            put("etiqueta", marcador.etiqueta)
            put("creado_en", marcador.creadoEn)
            put("actualizado_en", marcador.actualizadoEn)
            put("borrado_en", marcador.borradoEn)
            put("pendiente", if (marcador.pendiente) 1 else 0)
        }
        // Conflicto por `(documento_id, pagina)`: volver a marcar una página
        // reutiliza su fila en vez de crear una segunda que el servidor
        // rechazaría.
        helper.writableDatabase.insertWithOnConflict("marcadores", null, valores, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun marcadoresPendientes(): List<Marcador> = helper.readableDatabase.rawQuery(
        """
        SELECT m.* FROM marcadores m
        JOIN documentos d ON d.id = m.documento_id
        WHERE m.pendiente = 1 AND d.origen = 'REMOTO'
        """.trimIndent(),
        null,
    ).use { it.mapear(::marcadorDe) }

    // ---------------------------------------------------------- limpieza --
    /** Marca como subido lo que el servidor ha aceptado. */
    fun marcarSincronizado(progresos: List<String>, anotaciones: List<String>, marcadores: List<String>) {
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            progresos.forEach { db.execSQL("UPDATE progreso SET pendiente = 0 WHERE documento_id = ?", arrayOf(it)) }
            anotaciones.forEach { db.execSQL("UPDATE anotaciones SET pendiente = 0 WHERE id = ?", arrayOf(it)) }
            marcadores.forEach { db.execSQL("UPDATE marcadores SET pendiente = 0 WHERE id = ?", arrayOf(it)) }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun enTransaccion(bloque: () -> Unit) {
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            bloque()
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }
}

// ================================================================ mapeo ======

private fun <T> Cursor.mapear(fila: (Cursor) -> T): List<T> = buildList {
    while (moveToNext()) add(fila(this@mapear))
}

private fun Cursor.textoOpcional(columna: String): String? {
    val indice = getColumnIndexOrThrow(columna)
    return if (isNull(indice)) null else getString(indice)
}

private fun Cursor.enteroOpcional(columna: String): Int? {
    val indice = getColumnIndexOrThrow(columna)
    return if (isNull(indice)) null else getInt(indice)
}

private fun Cursor.largoOpcional(columna: String): Long? {
    val indice = getColumnIndexOrThrow(columna)
    return if (isNull(indice)) null else getLong(indice)
}

private fun documentoDe(c: Cursor) = Documento(
    id = c.getString(c.getColumnIndexOrThrow("id")),
    origen = Origen.valueOf(c.getString(c.getColumnIndexOrThrow("origen"))),
    titulo = c.getString(c.getColumnIndexOrThrow("titulo")),
    autor = c.textoOpcional("autor"),
    paginas = c.enteroOpcional("paginas"),
    uri = c.textoOpcional("uri"),
    rutaFichero = c.textoOpcional("ruta_fichero"),
    tamanoBytes = c.getLong(c.getColumnIndexOrThrow("tamano_bytes")),
    checksum = c.textoOpcional("checksum"),
    creadoEn = c.getLong(c.getColumnIndexOrThrow("creado_en")),
    actualizadoEn = c.getLong(c.getColumnIndexOrThrow("actualizado_en")),
    leidoEn = c.largoOpcional("leido_en"),
)

private fun progresoDe(c: Cursor) = Progreso(
    documentoId = c.getString(c.getColumnIndexOrThrow("documento_id")),
    pagina = c.getInt(c.getColumnIndexOrThrow("pagina")),
    scrollMilesimas = c.getInt(c.getColumnIndexOrThrow("scroll_milesimas")),
    actualizadoEn = c.getLong(c.getColumnIndexOrThrow("actualizado_en")),
    pendiente = c.getInt(c.getColumnIndexOrThrow("pendiente")) == 1,
)

private fun anotacionDe(c: Cursor) = Anotacion(
    id = c.getString(c.getColumnIndexOrThrow("id")),
    documentoId = c.getString(c.getColumnIndexOrThrow("documento_id")),
    tipo = TipoAnotacion.valueOf(c.getString(c.getColumnIndexOrThrow("tipo"))),
    pagina = c.getInt(c.getColumnIndexOrThrow("pagina")),
    rects = jsonARects(c.textoOpcional("rects")),
    cita = c.textoOpcional("cita"),
    texto = c.textoOpcional("texto"),
    color = ColorAnotacion.valueOf(c.getString(c.getColumnIndexOrThrow("color"))),
    creadoEn = c.getLong(c.getColumnIndexOrThrow("creado_en")),
    actualizadoEn = c.getLong(c.getColumnIndexOrThrow("actualizado_en")),
    borradoEn = c.largoOpcional("borrado_en"),
    pendiente = c.getInt(c.getColumnIndexOrThrow("pendiente")) == 1,
)

private fun marcadorDe(c: Cursor) = Marcador(
    id = c.getString(c.getColumnIndexOrThrow("id")),
    documentoId = c.getString(c.getColumnIndexOrThrow("documento_id")),
    pagina = c.getInt(c.getColumnIndexOrThrow("pagina")),
    etiqueta = c.textoOpcional("etiqueta"),
    creadoEn = c.getLong(c.getColumnIndexOrThrow("creado_en")),
    actualizadoEn = c.getLong(c.getColumnIndexOrThrow("actualizado_en")),
    borradoEn = c.largoOpcional("borrado_en"),
    pendiente = c.getInt(c.getColumnIndexOrThrow("pendiente")) == 1,
)

/** Los rectángulos se guardan como JSON, igual que en el servidor. */
fun rectsAJson(rects: List<Rect>): String? {
    if (rects.isEmpty()) return null
    val array = JSONArray()
    rects.forEach { r ->
        array.put(
            JSONObject().apply {
                put("x", r.x.toDouble())
                put("y", r.y.toDouble())
                put("w", r.w.toDouble())
                put("h", r.h.toDouble())
            },
        )
    }
    return array.toString()
}

/**
 * Un JSON ilegible devuelve lista vacía en vez de tumbar el lector: una nota
 * sin rectángulos se sigue pudiendo leer, y un documento que no abre por una
 * anotación rota sería mucho peor.
 */
fun jsonARects(bruto: String?): List<Rect> {
    if (bruto.isNullOrBlank()) return emptyList()
    return runCatching {
        val array = JSONArray(bruto)
        buildList {
            for (i in 0 until array.length()) {
                val o = array.getJSONObject(i)
                add(
                    Rect(
                        o.optDouble("x", 0.0).toFloat(),
                        o.optDouble("y", 0.0).toFloat(),
                        o.optDouble("w", 0.0).toFloat(),
                        o.optDouble("h", 0.0).toFloat(),
                    ),
                )
            }
        }
    }.getOrDefault(emptyList())
}
