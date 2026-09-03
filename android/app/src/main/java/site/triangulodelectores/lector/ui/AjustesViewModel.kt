package site.triangulodelectores.lector.ui

import android.os.Build
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import site.triangulodelectores.lector.BuildConfig
import site.triangulodelectores.lector.Contenedor
import site.triangulodelectores.lector.data.remote.FalloApi
import site.triangulodelectores.lector.sync.TrabajoSincronizacion

data class EstadoAjustes(
    val emparejado: Boolean = false,
    val dispositivo: String? = null,
    val caducidad: Long = 0,
    val ultimaSincronizacion: Long = 0,
    val soloWifi: Boolean = true,
    val trabajando: Boolean = false,
    val aviso: String? = null,
    val versionDisponible: String? = null,
)

/**
 * Emparejamiento y mantenimiento.
 *
 * El emparejamiento pide email y contraseña una vez y guarda un **token de
 * dispositivo**, no la contraseña: si el teléfono se pierde, se retira ese
 * token desde el servidor y la contraseña no ha cambiado de manos.
 */
class AjustesViewModel(private val contenedor: Contenedor) : ViewModel() {

    private val _estado = MutableStateFlow(estadoActual())
    val estado: StateFlow<EstadoAjustes> = _estado.asStateFlow()

    private fun estadoActual() = EstadoAjustes(
        emparejado = contenedor.credenciales.emparejado,
        dispositivo = contenedor.credenciales.nombreDispositivo(),
        caducidad = contenedor.credenciales.caducidad(),
        ultimaSincronizacion = contenedor.ajustes.ultimaSincronizacion,
        soloWifi = contenedor.ajustes.soloWifi,
    )

    /** Nombre por omisión del dispositivo: el modelo del teléfono. */
    fun nombrePorOmision(): String = "${Build.MANUFACTURER.replaceFirstChar { it.uppercase() }} ${Build.MODEL}".take(80)

    fun emparejar(email: String, password: String, dispositivo: String) {
        if (email.isBlank() || password.isBlank()) {
            _estado.update { it.copy(aviso = "Hacen falta el email y la contraseña.") }
            return
        }

        viewModelScope.launch {
            _estado.update { it.copy(trabajando = true, aviso = null) }

            val resultado = withContext(Dispatchers.IO) {
                runCatching {
                    val sesion = contenedor.api.emparejar(email.trim(), password, dispositivo.ifBlank { nombrePorOmision() })
                    contenedor.credenciales.guardarToken(sesion.token, dispositivo, sesion.expiresAt)
                    // La primera sincronización trae la estantería entera: sin
                    // ella, emparejar parece no haber hecho nada.
                    contenedor.sincronizador.sincronizar()
                    sesion
                }
            }

            resultado
                .onSuccess { sesion ->
                    TrabajoSincronizacion.programar(contenedor.contexto, contenedor.ajustes.soloWifi)
                    _estado.value = estadoActual().copy(
                        aviso = "Emparejado como ${sesion.user.displayName}.",
                    )
                }
                .onFailure { fallo ->
                    val mensaje = when (fallo) {
                        is FalloApi.SinRed ->
                            "No hay conexión con la biblioteca. Comprueba la red e inténtalo de nuevo."
                        is FalloApi.Credencial ->
                            // El servidor distingue credenciales incorrectas de
                            // cuenta bloqueada, y ese matiz llega hasta aquí:
                            // «error de acceso» a secas deja sin saber si hay
                            // que esperar o revisar la contraseña.
                            fallo.message ?: "Credenciales incorrectas."
                        else -> fallo.message ?: "No se ha podido emparejar."
                    }
                    _estado.update { it.copy(trabajando = false, aviso = mensaje) }
                }
        }
    }

    fun sincronizar() {
        viewModelScope.launch {
            _estado.update { it.copy(trabajando = true) }
            val resultado = withContext(Dispatchers.IO) { runCatching { contenedor.sincronizador.sincronizar() } }
            _estado.value = estadoActual().copy(
                aviso = resultado.fold(
                    onSuccess = { "Sincronizado: ${it.subidos} enviados, ${it.bajados} recibidos." },
                    onFailure = { fallo -> fallo.message ?: "No se ha podido sincronizar." },
                ),
            )
        }
    }

    /**
     * Desempareja.
     *
     * Se avisa al servidor para que retire el token, pero **si no hay red se
     * olvida igualmente aquí**: quien va a vender el teléfono no puede quedarse
     * con la credencial dentro por no tener cobertura en ese momento.
     */
    fun desemparejar() {
        viewModelScope.launch {
            withContext(Dispatchers.IO) {
                runCatching { contenedor.api.desemparejar() }
                contenedor.olvidarCuenta()
            }
            TrabajoSincronizacion.cancelar(contenedor.contexto)
            _estado.value = estadoActual().copy(
                aviso = "Este teléfono ya no está emparejado. Lo leído en local sigue aquí.",
            )
        }
    }

    fun cambiarSoloWifi(valor: Boolean) {
        contenedor.ajustes.soloWifi = valor
        if (contenedor.credenciales.emparejado) {
            TrabajoSincronizacion.programar(contenedor.contexto, valor, reemplazar = true)
        }
        _estado.update { it.copy(soloWifi = valor) }
    }

    /** ¿Hay una versión más nueva publicada en el sitio? */
    fun comprobarActualizacion() {
        viewModelScope.launch {
            val version = withContext(Dispatchers.IO) { contenedor.api.ultimaVersion() }
            _estado.update {
                when {
                    version == null -> it.copy(aviso = "No se ha podido comprobar si hay versión nueva.")
                    version.versionCode > BuildConfig.VERSION_CODE ->
                        it.copy(versionDisponible = version.version, aviso = "Hay una versión nueva: ${version.version}.")
                    else -> it.copy(aviso = "Esta es la última versión publicada.")
                }
            }
        }
    }

    fun avisoVisto() = _estado.update { it.copy(aviso = null) }
}
