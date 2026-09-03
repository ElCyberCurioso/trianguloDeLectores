package site.triangulodelectores.lector

import android.app.Application
import android.content.Context
import site.triangulodelectores.lector.data.Biblioteca
import site.triangulodelectores.lector.data.Sincronizador
import site.triangulodelectores.lector.data.local.Ajustes
import site.triangulodelectores.lector.data.local.Almacen
import site.triangulodelectores.lector.data.local.BaseDatos
import site.triangulodelectores.lector.data.local.Credenciales
import site.triangulodelectores.lector.data.remote.Api
import site.triangulodelectores.lector.pdf.CachePaginas
import site.triangulodelectores.lector.sync.TrabajoSincronizacion

/**
 * Cableado de la aplicación.
 *
 * A mano y en una clase, sin librería de inyección: son seis piezas y una sola
 * forma de construirlas. Es el mismo criterio que el contenedor por petición
 * del servidor, y por el mismo motivo -- que se vea de dónde sale cada cosa.
 */
class Contenedor(contexto: Context) {
    /** Contexto de aplicación, nunca el de una pantalla: vive más que ellas. */
    val contexto: Context = contexto.applicationContext
    val credenciales = Credenciales(contexto)
    val ajustes = Ajustes(contexto)
    val almacen = Almacen(BaseDatos(contexto))
    val api = Api(credenciales)
    val biblioteca = Biblioteca(contexto, almacen, api)
    val sincronizador = Sincronizador(almacen, api, credenciales, ajustes)
    val cachePaginas = CachePaginas()

    /** Al desemparejar se va el token y la marca de agua, no lo leído. */
    fun olvidarCuenta() {
        credenciales.olvidar()
        ajustes.olvidar()
    }
}

class TdlApp : Application() {
    lateinit var contenedor: Contenedor
        private set

    override fun onCreate() {
        super.onCreate()
        contenedor = Contenedor(this)
        if (contenedor.credenciales.emparejado) {
            TrabajoSincronizacion.programar(this, contenedor.ajustes.soloWifi)
        }
    }
}
