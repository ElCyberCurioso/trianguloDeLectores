package site.triangulodelectores.lector

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import site.triangulodelectores.lector.ui.AjustesScreen
import site.triangulodelectores.lector.ui.AjustesViewModel
import site.triangulodelectores.lector.ui.BibliotecaScreen
import site.triangulodelectores.lector.ui.BibliotecaViewModel
import site.triangulodelectores.lector.ui.EstanteriaScreen
import site.triangulodelectores.lector.ui.EstanteriaViewModel
import site.triangulodelectores.lector.ui.LectorScreen
import site.triangulodelectores.lector.ui.LectorViewModel
import site.triangulodelectores.lector.ui.theme.TemaTdl

/**
 * Una sola pantalla real y tres destinos.
 *
 * La aplicación no necesita más: estantería, lector y ajustes. Todo lo que se
 * ve sale de la base de datos local, así que abre igual con red y sin ella.
 */
class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val contenedor = (application as TdlApp).contenedor

        /*
         * PDF abierto desde otra aplicación (gestor de archivos, correo, un
         * enlace). Se importa a la estantería antes de pintar nada y se abre
         * directamente: quien llega así quiere leer ese documento, no ver una
         * lista donde buscarlo.
         *
         * La URI que llega en un `VIEW` es de un solo uso y no admite permiso
         * persistente, así que el documento queda importado pero puede dejar de
         * abrirse al reiniciar. Es el comportamiento correcto: para tenerlo
         * siempre, se añade desde «Abrir un PDF del teléfono».
         */
        val documentoDeIntent = if (intent?.action == Intent.ACTION_VIEW) {
            intent.data?.let { uri ->
                runCatching { contenedor.biblioteca.importarLocal(uri) }
                    .recoverCatching { contenedor.biblioteca.importarEfimero(uri) }
                    .getOrNull()
            }
        } else {
            null
        }

        setContent {
            TemaTdl {
                val navegacion = rememberNavController()

                LaunchedEffect(documentoDeIntent) {
                    documentoDeIntent?.let { navegacion.navigate("lector/${it.id}") }
                }

                NavHost(navController = navegacion, startDestination = "estanteria") {
                    composable("estanteria") {
                        val modelo: EstanteriaViewModel = viewModel(factory = fabrica(contenedor))
                        EstanteriaScreen(
                            modelo = modelo,
                            alAbrir = { documento -> navegacion.navigate("lector/${documento.id}") },
                            alIrAAjustes = { navegacion.navigate("ajustes") },
                            alIrABiblioteca = { navegacion.navigate("biblioteca") },
                        )
                    }

                    composable(
                        route = "lector/{id}",
                        arguments = listOf(navArgument("id") { type = NavType.StringType }),
                    ) { entrada ->
                        val id = entrada.arguments?.getString("id").orEmpty()
                        // El modelo se ata al documento: cambiar de libro tiene
                        // que abrir otro `PdfRenderer`, no reutilizar el que hay.
                        val modelo: LectorViewModel = viewModel(
                            key = "lector-$id",
                            factory = fabricaLector(contenedor, id),
                        )
                        LectorScreen(
                            modelo = modelo,
                            cache = contenedor.cachePaginas,
                            alVolver = { navegacion.popBackStack() },
                        )
                    }

                    composable("biblioteca") {
                        val modelo: BibliotecaViewModel = viewModel(factory = fabrica(contenedor))
                        BibliotecaScreen(
                            modelo = modelo,
                            alVolver = { navegacion.popBackStack() },
                        )
                    }

                    composable("ajustes") {
                        val modelo: AjustesViewModel = viewModel(factory = fabrica(contenedor))
                        AjustesScreen(modelo = modelo, alVolver = { navegacion.popBackStack() })
                    }
                }
            }
        }
    }
}

/**
 * Fábrica de modelos.
 *
 * A mano, sin librería de inyección: son tres modelos y una dependencia. Lo que
 * importa es que el contenedor sea el de la aplicación y no uno nuevo por
 * pantalla, porque la caché de páginas y la base de datos tienen que ser las
 * mismas.
 */
private fun fabrica(contenedor: Contenedor) = object : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = when {
        modelClass.isAssignableFrom(EstanteriaViewModel::class.java) -> EstanteriaViewModel(contenedor) as T
        modelClass.isAssignableFrom(AjustesViewModel::class.java) -> AjustesViewModel(contenedor) as T
        modelClass.isAssignableFrom(BibliotecaViewModel::class.java) -> BibliotecaViewModel(contenedor) as T
        else -> throw IllegalArgumentException("Modelo desconocido: ${modelClass.name}")
    }
}

private fun fabricaLector(contenedor: Contenedor, documentoId: String) = object : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T = LectorViewModel(contenedor, documentoId) as T
}
