package site.triangulodelectores.lector.data.remote

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import site.triangulodelectores.lector.BuildConfig
import site.triangulodelectores.lector.data.local.Credenciales
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Fallo con nombre. La pantalla necesita distinguir tres cosas para decir algo
 * útil: que no hay red, que la credencial ya no vale y que el servidor ha dicho
 * que no. Un `IOException` genérico las confunde todas en «error de conexión»,
 * que es lo que hace que nadie sepa si apagar el wifi o volver a entrar.
 */
sealed class FalloApi(mensaje: String) : Exception(mensaje) {
    class SinRed(mensaje: String) : FalloApi(mensaje)
    class Credencial(mensaje: String) : FalloApi(mensaje)
    class Servidor(val codigo: Int, val codigoApi: String, mensaje: String) : FalloApi(mensaje)
}

/**
 * Cliente de la API de la biblioteca privada.
 *
 * Toda petición lleva el token del dispositivo en `Authorization`. No hay
 * cookies: el cliente no tiene `CookieJar`, así que aunque el servidor mandara
 * una `Set-Cookie` no se guardaría ni se reenviaría. Es la propiedad que separa
 * esta aplicación del navegador.
 */
class Api(private val credenciales: Credenciales) {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private val cliente = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        // La descarga de un PDF de 50 MB por una red mala tarda: el techo de
        // escritura corto cortaba subidas de sincronización a medias.
        .writeTimeout(60, TimeUnit.SECONDS)
        .retryOnConnectionFailure(true)
        .build()

    private val base = BuildConfig.BOOKS_URL.trimEnd('/')

    // ---------------------------------------------------------- emparejar --
    fun emparejar(email: String, password: String, dispositivo: String): SesionDto {
        val cuerpo = json.encodeToString(
            JsonObject.serializer(),
            JsonObject(
                mapOf(
                    "email" to kotlinx.serialization.json.JsonPrimitive(email),
                    "password" to kotlinx.serialization.json.JsonPrimitive(password),
                    "device" to kotlinx.serialization.json.JsonPrimitive(dispositivo),
                ),
            ),
        )

        val peticion = Request.Builder()
            .url("$base/api/movil/sesion")
            .post(cuerpo.toRequestBody(JSON_MEDIA))
            .header("Accept", "application/json")
            .build()

        return ejecutar(peticion) { datos -> json.decodeFromJsonElement(SesionDto.serializer(), datos) }
    }

    /** Retira este dispositivo. El token deja de valer en el servidor. */
    fun desemparejar() {
        val peticion = autenticada("$base/api/movil/sesion").delete().build()
        runCatching { ejecutar(peticion) { } }
    }

    // --------------------------------------------------------- documentos --
    fun documentos(): ListaDocumentosDto {
        val peticion = autenticada("$base/api/movil/documentos").get().build()
        return ejecutar(peticion) { json.decodeFromJsonElement(ListaDocumentosDto.serializer(), it) }
    }

    fun documento(id: String): DetalleDocumentoDto {
        val peticion = autenticada("$base/api/movil/documentos/$id").get().build()
        return ejecutar(peticion) { json.decodeFromJsonElement(DetalleDocumentoDto.serializer(), it) }
    }

    fun comunicarPaginas(id: String, paginas: Int) {
        val peticion = autenticada("$base/api/movil/documentos/$id/paginas")
            .put("""{"pageCount":$paginas}""".toRequestBody(JSON_MEDIA))
            .build()
        runCatching { ejecutar(peticion) { } }
    }

    /**
     * Descarga el PDF a un fichero, continuando lo que ya hubiera.
     *
     * Se pide con `Range` desde el byte donde se quedó la descarga anterior: un
     * libro escaneado son decenas de megas y el metro se acaba antes que la
     * descarga. Si el servidor no responde 206 se empieza de cero, que es lo
     * correcto -- el fichero ha podido cambiar.
     */
    fun descargar(id: String, destino: File, alAvanzar: (Long, Long) -> Unit = { _, _ -> }) {
        val parcial = File(destino.parentFile, destino.name + ".parcial")
        val yaDescargado = if (parcial.exists()) parcial.length() else 0L

        val peticion = autenticada("$base/api/movil/documentos/$id/fichero")
            .apply { if (yaDescargado > 0) header("Range", "bytes=$yaDescargado-") }
            .get()
            .build()

        val respuesta = try {
            cliente.newCall(peticion).execute()
        } catch (e: IOException) {
            throw FalloApi.SinRed(e.message ?: "No hay conexión")
        }

        respuesta.use {
            if (it.code == 401) throw FalloApi.Credencial("La credencial del dispositivo ya no vale")
            if (!it.isSuccessful) throw FalloApi.Servidor(it.code, "download_failed", "No se ha podido descargar")

            val continuando = it.code == 206 && yaDescargado > 0
            if (!continuando && parcial.exists()) parcial.delete()

            val total = (it.body?.contentLength() ?: -1L).let { largo ->
                if (largo > 0) largo + (if (continuando) yaDescargado else 0L) else -1L
            }

            var escritos = if (continuando) yaDescargado else 0L
            // En modo «continuar» se abre en append: `File.outputStream()`
            // truncaría el fichero y tiraría a la basura justamente lo que se
            // había descargado antes de perder la red.
            FileOutputStream(parcial, continuando).use { flujo ->
                val buffer = ByteArray(64 * 1024)
                val entrada = it.body!!.byteStream()
                while (true) {
                    val leidos = entrada.read(buffer)
                    if (leidos <= 0) break
                    flujo.write(buffer, 0, leidos)
                    escritos += leidos
                    alAvanzar(escritos, total)
                }
            }
        }

        // El fichero sólo pasa a su nombre definitivo cuando está entero: así
        // una descarga cortada nunca se toma por un PDF completo.
        if (destino.exists()) destino.delete()
        parcial.renameTo(destino)
    }

    // ----------------------------------------------------- sincronización --
    fun bajar(desde: Long): BajadaDto {
        val peticion = autenticada("$base/api/movil/sincronizacion?desde=$desde").get().build()
        return ejecutar(peticion) { json.decodeFromJsonElement(BajadaDto.serializer(), it) }
    }

    fun subir(cambios: SubidaDto): ResultadoSubidaDto {
        val cuerpo = json.encodeToString(SubidaDto.serializer(), cambios)
        val peticion = autenticada("$base/api/movil/sincronizacion")
            .post(cuerpo.toRequestBody(JSON_MEDIA))
            .build()
        return ejecutar(peticion) { json.decodeFromJsonElement(ResultadoSubidaDto.serializer(), it) }
    }

    // -------------------------------------------------------- versión app --
    /**
     * Última versión publicada. Vive en el sitio público, no aquí: sin Play
     * Store no hay quien avise de que hay actualización, y preguntar por ella
     * no debería exigir estar emparejado.
     */
    fun ultimaVersion(): VersionDto? {
        val peticion = Request.Builder()
            .url("${BuildConfig.SITE_URL.trimEnd('/')}/aplicacion/version.json")
            .header("Accept", "application/json")
            .get()
            .build()

        return runCatching {
            cliente.newCall(peticion).execute().use { respuesta ->
                if (!respuesta.isSuccessful) return null
                json.decodeFromString(VersionDto.serializer(), respuesta.body!!.string())
            }
        }.getOrNull()
    }

    // ------------------------------------------------------------ interno --
    private fun autenticada(url: String): Request.Builder {
        val token = credenciales.token() ?: throw FalloApi.Credencial("Este teléfono no está emparejado")
        return Request.Builder()
            .url(url)
            .header("Authorization", "Bearer $token")
            .header("Accept", "application/json")
    }

    /**
     * Ejecuta y desenvuelve `{ ok, data }`.
     *
     * El 401 se traduce a `FalloApi.Credencial` en un único sitio: es lo que
     * permite que la aplicación reaccione siempre igual -- pedir que se vuelva
     * a emparejar -- sin que cada llamada tenga que acordarse.
     */
    private fun <T> ejecutar(peticion: Request, mapear: (kotlinx.serialization.json.JsonElement) -> T): T {
        val respuesta: Response = try {
            cliente.newCall(peticion).execute()
        } catch (e: IOException) {
            throw FalloApi.SinRed(e.message ?: "No hay conexión")
        }

        respuesta.use {
            val texto = it.body?.string().orEmpty()

            if (it.code == 401 || it.code == 403) {
                throw FalloApi.Credencial(mensajeDeError(texto) ?: "La credencial del dispositivo ya no vale")
            }
            if (!it.isSuccessful) {
                throw FalloApi.Servidor(it.code, codigoDeError(texto) ?: "http_${it.code}", mensajeDeError(texto) ?: "El servidor ha rechazado la petición")
            }

            val raiz = runCatching { json.parseToJsonElement(texto).jsonObject }.getOrNull()
                ?: throw FalloApi.Servidor(it.code, "respuesta_ilegible", "El servidor ha respondido algo que no se entiende")

            val datos = raiz["data"]
                ?: throw FalloApi.Servidor(it.code, "respuesta_sin_datos", "El servidor ha respondido sin datos")

            return mapear(datos)
        }
    }

    private fun mensajeDeError(texto: String): String? = runCatching {
        json.parseToJsonElement(texto).jsonObject["error"]?.jsonObject?.get("message")?.jsonPrimitive?.content
    }.getOrNull()

    private fun codigoDeError(texto: String): String? = runCatching {
        json.parseToJsonElement(texto).jsonObject["error"]?.jsonObject?.get("code")?.jsonPrimitive?.content
    }.getOrNull()

    private companion object {
        val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}
