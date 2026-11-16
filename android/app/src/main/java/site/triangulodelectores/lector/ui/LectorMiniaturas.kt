package site.triangulodelectores.lector.ui

import android.util.LruCache
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.delay
import site.triangulodelectores.lector.pdf.DocumentoPdf

/** Ancho al que se pinta cada miniatura. Lo justo para reconocer la página. */
private const val ANCHO_MINIATURA_PX = 180

/**
 * Cuántas miniaturas se guardan. Una de 180 px de ancho son unos 150 kB, así que
 * esto son unos siete megas: lo bastante para volver atrás en la rejilla sin
 * repintar, y nada comparado con una sola página a tamaño de lectura.
 */
private const val MINIATURAS_EN_MEMORIA = 48

/**
 * Todas las páginas a la vez, en pequeño, para ir a una de un vistazo.
 *
 * Es lo que hace falta en un escaneado: sin texto no hay búsqueda, y sin
 * índice lo único que queda para encontrar una lámina o el principio de un
 * capítulo es verlos. La página en la que se está va recuadrada en el rojo, y
 * las marcadas llevan su pestaña.
 *
 * Se pinta con el mismo renderer que la lectura y con la misma espera antes de
 * pedir el pintado: al deslizar la rejilla deprisa, lo que pasa volando no se
 * pinta. Las miniaturas tienen su propia caché pequeña; meterlas en la de las
 * páginas haría que una miniatura sustituyera a la página nítida que había.
 */
@Composable
fun PantallaMiniaturas(
    pdf: DocumentoPdf,
    paginas: Int,
    actual: Int,
    marcadores: List<Int>,
    alIr: (Int) -> Unit,
    alCerrar: () -> Unit,
) {
    val cache = remember { LruCache<Int, ImageBitmap>(MINIATURAS_EN_MEMORIA) }
    // Se abre con la página actual a la vista, no con la primera.
    val rejilla = rememberLazyGridState(initialFirstVisibleItemIndex = (actual - 1).coerceAtLeast(0))
    val marcadas = remember(marcadores) { marcadores.toSet() }

    Dialog(onDismissRequest = alCerrar, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(
            Modifier.fillMaxSize(),
            color = MaterialTheme.colorScheme.background,
            contentColor = MaterialTheme.colorScheme.onBackground,
        ) {
            Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                Row(
                    Modifier
                        .fillMaxWidth()
                        .background(MaterialTheme.colorScheme.surface)
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        "Cerrar",
                        style = MaterialTheme.typography.labelLarge,
                        modifier = Modifier
                            .clickable(onClick = alCerrar)
                            .padding(horizontal = 10.dp, vertical = 12.dp),
                    )
                    Text(
                        "Páginas",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(horizontal = 8.dp),
                    )
                }
                ReglaGruesa()

                LazyVerticalGrid(
                    columns = GridCells.Adaptive(minSize = 96.dp),
                    state = rejilla,
                    modifier = Modifier.weight(1f),
                    horizontalArrangement = Arrangement.spacedBy(12.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                    contentPadding = PaddingValues(16.dp),
                ) {
                    items(paginas, key = { it }) { indice ->
                        Miniatura(
                            pdf = pdf,
                            indice = indice,
                            cache = cache,
                            actual = indice + 1 == actual,
                            marcada = (indice + 1) in marcadas,
                            alTocar = { alIr(indice + 1) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun Miniatura(
    pdf: DocumentoPdf,
    indice: Int,
    cache: LruCache<Int, ImageBitmap>,
    actual: Boolean,
    marcada: Boolean,
    alTocar: () -> Unit,
) {
    var imagen by remember(indice) { mutableStateOf(cache.get(indice)) }
    val proporcion = pdf.proporcionConocida(indice) ?: 1.414f

    LaunchedEffect(indice) {
        if (imagen != null) return@LaunchedEffect
        delay(60)
        val pintada = runCatching { pdf.pintar(indice, ANCHO_MINIATURA_PX) }.getOrNull() ?: return@LaunchedEffect
        val mapa = pintada.asImageBitmap()
        cache.put(indice, mapa)
        imagen = mapa
    }

    Column(
        Modifier
            .clickable(onClickLabel = "Ir a la página ${indice + 1}", onClick = alTocar)
            .semantics { contentDescription = "Página ${indice + 1}" },
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .aspectRatio(1f / proporcion)
                .background(Color.White)
                .border(
                    width = if (actual) 3.dp else 1.dp,
                    color = if (actual) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.outline,
                ),
        ) {
            imagen?.let {
                Image(
                    bitmap = it,
                    contentDescription = null,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.FillBounds,
                )
            }
            if (marcada) {
                // La pestaña del marcador, arriba a la derecha, que es donde
                // se dobla una página.
                Box(
                    Modifier
                        .align(Alignment.TopEnd)
                        .width(10.dp)
                        .height(24.dp)
                        .background(MaterialTheme.colorScheme.primary),
                )
            }
        }
        Text(
            "${indice + 1}",
            style = MaterialTheme.typography.labelMedium,
            color = if (actual) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}
