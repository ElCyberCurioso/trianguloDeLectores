package site.triangulodelectores.lector.sync

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import site.triangulodelectores.lector.TdlApp
import site.triangulodelectores.lector.data.Sincronizador
import site.triangulodelectores.lector.data.remote.FalloApi
import java.util.concurrent.TimeUnit

/**
 * Sincronización periódica en segundo plano.
 *
 * Existe para el caso que de otro modo se pierde: leer un rato en el metro, sin
 * red, cerrar la aplicación y no volver a abrirla en una semana. Sin esto, el
 * navegador seguiría creyendo que el libro va por donde iba hace siete días.
 *
 * Se reintenta con `Result.retry()` sólo cuando el fallo es de red. Si la
 * credencial ha caducado no se reintenta: no hay nada que reintentar hasta que
 * alguien vuelva a emparejar, y WorkManager estaría despertando la aplicación
 * cada cuarto de hora para chocar contra el mismo 401.
 */
class TrabajoSincronizacion(contexto: Context, parametros: WorkerParameters) :
    CoroutineWorker(contexto, parametros) {

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val app = applicationContext as TdlApp
        if (!app.contenedor.credenciales.emparejado) return@withContext Result.success()

        try {
            app.contenedor.sincronizador.sincronizar()
            Result.success()
        } catch (e: FalloApi.SinRed) {
            Result.retry()
        } catch (e: Sincronizador.CredencialCaducada) {
            Result.success()
        } catch (e: Exception) {
            Result.failure()
        }
    }

    companion object {
        private const val NOMBRE = "sincronizacion-biblioteca"

        /**
         * Cada seis horas y sólo con red. El progreso de lectura no es un chat:
         * sincronizar más a menudo gastaría batería para mover unos pocos
         * enteros, y la aplicación ya sincroniza al abrirse y al salir de un
         * libro, que es cuando de verdad hay algo que contar.
         */
        fun programar(contexto: Context, soloWifi: Boolean = true, reemplazar: Boolean = false) {
            val peticion = PeriodicWorkRequestBuilder<TrabajoSincronizacion>(6, TimeUnit.HOURS)
                .setConstraints(
                    Constraints.Builder()
                        // Lo que viaja son unos pocos kilobytes, pero quien pone
                        // «sólo wifi» lo pone para todo: respetarlo a medias es
                        // no respetarlo.
                        .setRequiredNetworkType(if (soloWifi) NetworkType.UNMETERED else NetworkType.CONNECTED)
                        .build(),
                )
                .build()

            WorkManager.getInstance(contexto).enqueueUniquePeriodicWork(
                NOMBRE,
                if (reemplazar) ExistingPeriodicWorkPolicy.UPDATE else ExistingPeriodicWorkPolicy.KEEP,
                peticion,
            )
        }

        fun cancelar(contexto: Context) {
            WorkManager.getInstance(contexto).cancelUniqueWork(NOMBRE)
        }
    }
}
