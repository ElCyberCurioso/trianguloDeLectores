package site.triangulodelectores.lector.ui

import kotlinx.coroutines.delay
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.DropdownMenu
import android.content.Intent
import android.content.Context
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.Dialog
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import site.triangulodelectores.lector.data.local.Anotacion
import site.triangulodelectores.lector.data.local.ColorAnotacion
import site.triangulodelectores.lector.data.local.TipoAnotacion
import site.triangulodelectores.lector.pdf.Coincidencia
import site.triangulodelectores.lector.pdf.EntradaIndice
import site.triangulodelectores.lector.pdf.NotaIncrustada

/**
 * Barra del lector.
 *
 * Los controles son texto, no iconos sueltos: en una barra de siete cosas, un
 * icono sin etiqueta es una adivinanza. Todos tienen 44 dp de alto de zona
 * pulsable, que es lo que pide una pantalla táctil y el mínimo de WCAG 2.2 con
 * margen.
 */
@Composable
fun BarraLector(
    titulo: String,
    pagina: Int,
    paginas: Int,
    marcada: Boolean,
    modoSubrayado: Boolean,
    zoom: Float,
    alVolver: () -> Unit,
    alMarcar: () -> Unit,
    alSubrayar: () -> Unit,
    alAnotar: () -> Unit,
    alZoom: (Float) -> Unit,
    alVerAnotaciones: () -> Unit,
    /** Tocar «Página N de M» abre el salto a una página concreta. */
    alIrAPagina: () -> Unit,
    alBuscar: () -> Unit,
    /**
     * Todo en una fila. Se pide cuando el hueco es ancho —el teléfono en
     * horizontal, una tableta—: con dos filas la barra se comía un tercio de
     * la pantalla en horizontal antes de esconderse, y lo que sobraba era
     * ancho, no alto.
     */
    unaFila: Boolean = false,
    papel: Papel = Papel.BLANCO,
    alElegirPapel: (Papel) -> Unit = {},
) {
    /*
     * El título y la página son también el botón de «ir a página».
     *
     * Es donde se mira cuando se quiere saber dónde se está, y por tanto donde
     * se toca cuando se quiere estar en otro sitio. Un control aparte para lo
     * mismo sería uno más en una barra que ya no tiene sitio.
     */
    val encabezado: @Composable (Modifier) -> Unit = { modifier ->
        Column(
            modifier
                .heightIn(min = 44.dp)
                .clickable(enabled = paginas > 0, onClickLabel = "Ir a una página", onClick = alIrAPagina)
                .padding(horizontal = 8.dp),
        ) {
            Text(
                titulo,
                style = MaterialTheme.typography.titleSmall,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (paginas > 0) {
                Text(
                    "Página $pagina de $paginas",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
    val anotar: @Composable () -> Unit = {
        ControlTexto("Subrayar", alSubrayar, activo = modoSubrayado)
        ControlTexto("Nota", alAnotar)
        ControlTexto("Notas", alVerAnotaciones)
    }
    val ampliar: @Composable () -> Unit = {
        // Paso multiplicativo, no aditivo: de 1 a 8 en sumas de medio punto
        // son catorce toques, y el salto que se percibe al ampliar no es el
        // mismo al principio que al final.
        ControlTexto("−", { alZoom(zoom / PASO_ZOOM) })
        MenuVista(zoom = zoom, papel = papel, alZoom = alZoom, alElegirPapel = alElegirPapel)
        ControlTexto("+", { alZoom(zoom * PASO_ZOOM) })
    }
    val marcar: @Composable () -> Unit = {
        // Arriba y no con el resto: la fila de abajo ya no tiene sitio en
        // vertical, y buscar es de las cosas que se hacen antes de leer.
        ControlTexto("Buscar", alBuscar)
        ControlTexto(if (marcada) "Marcada" else "Marcar", alMarcar, activo = marcada)
    }

    Column(Modifier.background(MaterialTheme.colorScheme.surface)) {
        if (unaFila) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ControlTexto("Volver", alVolver)
                encabezado(Modifier.weight(1f))
                anotar()
                ampliar()
                marcar()
            }
        } else {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp, vertical = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ControlTexto("Volver", alVolver)
                encabezado(Modifier.weight(1f))
                marcar()
            }
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                anotar()
                Box(Modifier.weight(1f))
                ampliar()
            }
        }

        ReglaGruesa()
    }
}

/** Hueco a partir del cual la barra cabe en una sola fila. */
const val ANCHO_BARRA_EN_UNA_FILA_DP = 600

/**
 * El aviso del modo subrayado, en una línea y con los colores al lado.
 *
 * Eran tres renglones de explicación y una fila de colores debajo, fijos encima
 * del documento mientras se subraya: lo que se quería marcar quedaba más abajo
 * de lo que se veía. Lo de las páginas escaneadas no hace falta decirlo —el
 * arrastre marca la zona solo, y se ve—.
 */
@Composable
fun AvisoSubrayado(color: ColorAnotacion, alElegirColor: (ColorAnotacion) -> Unit) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        ReglaGruesa(color = MaterialTheme.colorScheme.primary)
        Row(
            Modifier
                .fillMaxWidth()
                .padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "Arrastra sobre el texto o toca una palabra.",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.weight(1f).padding(end = 8.dp),
            )
            SelectorColor(activo = color, alElegir = alElegirColor)
        }
    }
}

/** Lo que cambia el zoom cada toque de los botones. */
private const val PASO_ZOOM = 1.5f

/** Control de barra. En rojo cuando está activo: el acento significa algo. */
@Composable
private fun ControlTexto(texto: String, onClick: () -> Unit, activo: Boolean = false) {
    Text(
        texto,
        style = MaterialTheme.typography.labelLarge,
        color = if (activo) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface,
        modifier = Modifier
            .heightIn(min = 44.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 10.dp, vertical = 12.dp),
    )
}

/**
 * Todo lo escrito sobre el documento, en un sitio.
 *
 * Es el equivalente del panel lateral del lector web. Sirve para lo que de
 * verdad se hace con las notas: repasarlas seguidas y volver a la página donde
 * estaban.
 */
@Composable
fun PanelAnotaciones(
    anotaciones: List<Anotacion>,
    marcadores: List<Int>,
    /** Las que trae el propio PDF. Se leen; no se editan ni se borran. */
    notasIncrustadas: List<NotaIncrustada>,
    leyendoNotasIncrustadas: Boolean,
    /** Ya se ha mirado dentro del PDF, con o sin resultado. */
    notasIncrustadasLeidas: Boolean,
    /** No se ha podido abrir el documento para mirarlo: cifrado o roto. */
    notasIncrustadasIlegibles: Boolean,
    alCerrar: () -> Unit,
    alIrA: (Int) -> Unit,
    alBorrar: (String) -> Unit,
    alEditar: (Anotacion) -> Unit,
    tituloDocumento: String = "",
    autorDocumento: String? = null,
) {
    val contexto = LocalContext.current
    val portapapeles = LocalClipboardManager.current

    /*
     * Filtro por color, sólo de lo propio: las notas del PDF no tienen color
     * nuestro. Nulo es «todos». Sólo aparece si hay más de un color, que si no
     * no hay nada que filtrar.
     */
    var filtro by remember { mutableStateOf<ColorAnotacion?>(null) }
    val colores = remember(anotaciones) { anotaciones.map { it.color }.distinct() }
    val visibles = remember(anotaciones, filtro) {
        filtro?.let { elegido -> anotaciones.filter { it.color == elegido } } ?: anotaciones
    }

    /*
     * A pantalla completa y no en un diálogo.
     *
     * Era un diálogo de 420 dp de alto con todo dentro: con una docena de
     * subrayados se repasaban a través de una rendija. Es una pantalla de
     * lectura —se recorre, se vuelve a la página, se corrige— y tiene que
     * tener el sitio de una.
     */
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
                    ControlTexto("Cerrar", alCerrar)
                    Text(
                        "Notas y subrayados",
                        style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 8.dp),
                    )
                    /*
                     * Exportar es mandar el texto a otra aplicación, no
                     * escribir un fichero: con la hoja de compartir del
                     * sistema se guarda en Drive, se pega en una nota o se
                     * manda por correo, y no hace falta pedir permiso para
                     * escribir en ningún sitio. Exporta todo, sin el filtro:
                     * el filtro es para mirar, no para decidir qué se lleva.
                     */
                    if (anotaciones.isNotEmpty() || marcadores.isNotEmpty()) {
                        ControlTexto("Exportar", {
                            compartirTexto(
                                contexto,
                                notasEnMarkdown(tituloDocumento, autorDocumento, anotaciones, marcadores),
                                asunto = "Notas de ${tituloDocumento.ifBlank { "un documento" }}",
                            )
                        })
                    }
                }
                ReglaGruesa()

                if (colores.size > 1) {
                    Row(
                        Modifier.padding(horizontal = 8.dp, vertical = 8.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        ControlTexto("Todos", { filtro = null }, activo = filtro == null)
                        ColorAnotacion.entries.filter { it in colores }.forEach { color ->
                            Box(
                                Modifier
                                    .size(44.dp)
                                    .background(colorDe(color))
                                    .clickable { filtro = if (filtro == color) null else color }
                                    .semantics {
                                        contentDescription = "Sólo en ${nombreDe(color).lowercase()}"
                                        selected = filtro == color
                                    },
                            ) {
                                if (filtro == color) {
                                    Box(
                                        Modifier
                                            .fillMaxWidth()
                                            .height(4.dp)
                                            .background(Color.Black),
                                    )
                                }
                            }
                        }
                    }
                    ReglaFina()
                }

                LazyColumn(
                    Modifier
                        .weight(1f)
                        .padding(horizontal = 16.dp),
                ) {
                    if (filtro != null && visibles.isEmpty()) {
                        item {
                            Text(
                                "No hay nada en este color.",
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.padding(vertical = 8.dp),
                            )
                        }
                    }
                    if (anotaciones.isEmpty() && marcadores.isEmpty()) {
                        item {
                            Text(
                                "Todavía no hay nada tuyo. Pulsa «Subrayar» y arrastra sobre el texto " +
                                    "de la página, o «Nota» para escribir algo en la página que estás leyendo.",
                                style = MaterialTheme.typography.bodyMedium,
                                modifier = Modifier.padding(vertical = 8.dp),
                            )
                        }
                    }
                    if (marcadores.isNotEmpty()) {
                        item {
                            Text(
                                "Páginas marcadas",
                                style = MaterialTheme.typography.titleSmall,
                                modifier = Modifier.padding(vertical = 8.dp),
                            )
                        }
                        item {
                            /*
                             * En `FlowRow` y no en `Row`: con una docena de
                             * páginas marcadas la fila se salía por la derecha y
                             * las últimas no había forma de tocarlas.
                             */
                            @OptIn(ExperimentalLayoutApi::class)
                            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                marcadores.sorted().forEach { pagina ->
                                    Text(
                                        "$pagina",
                                        style = MaterialTheme.typography.labelLarge,
                                        color = MaterialTheme.colorScheme.primary,
                                        modifier = Modifier
                                            .clickable { alIrA(pagina) }
                                            .padding(horizontal = 10.dp, vertical = 10.dp),
                                    )
                                }
                            }
                        }
                        item { ReglaFina(Modifier.padding(vertical = 8.dp)) }
                    }

                    items(visibles, key = { it.id }) { anotacion ->
                        val cita = anotacion.cita?.takeIf { it.isNotBlank() }
                        FilaAnotacion(
                            anotacion = anotacion,
                            alIr = { alIrA(anotacion.pagina) },
                            alBorrar = { alBorrar(anotacion.id) },
                            alEditar = { alEditar(anotacion) },
                            alCopiar = cita?.let { c ->
                                {
                                    portapapeles.setText(
                                        AnnotatedString(citaParaCompartir(c, tituloDocumento, anotacion.pagina)),
                                    )
                                }
                            },
                            alCompartir = cita?.let { c ->
                                { compartirTexto(contexto, citaParaCompartir(c, tituloDocumento, anotacion.pagina)) }
                            },
                        )
                        ReglaFina()
                    }

                    /*
                     * Lo que venía escrito en el PDF, aparte y al final.
                     *
                     * Van en su propia sección porque no son lo mismo: éstas
                     * las escribió quien hizo el documento o quien lo anotó
                     * antes, no se pueden tocar y no viajan al servidor.
                     * Mezclarlas con las propias en una sola lista sería
                     * prometer que se pueden borrar.
                     */
                    item { ReglaFina(Modifier.padding(vertical = 8.dp)) }
                    item {
                        Text(
                            "Notas del propio documento",
                            style = MaterialTheme.typography.titleSmall,
                            modifier = Modifier.padding(vertical = 8.dp),
                        )
                    }
                    /*
                     * La sección se pinta siempre, aunque salga vacía.
                     *
                     * Antes se escondía cuando no había nada, y entonces un
                     * documento que no se deja abrir -- cifrado, o roto -- se
                     * veía igual que uno que no trae notas: sin una línea que
                     * lo diga, no hay forma de saber cuál de las dos cosas es.
                     */
                    if (!notasIncrustadasLeidas || notasIncrustadas.isEmpty()) {
                        item {
                            Text(
                                when {
                                    leyendoNotasIncrustadas || !notasIncrustadasLeidas ->
                                        "Leyendo el documento…"
                                    notasIncrustadasIlegibles ->
                                        "No se ha podido abrir el documento para leer sus notas. " +
                                            "Suele pasar con los PDF protegidos con contraseña."
                                    else -> "Este documento no trae notas dentro."
                                },
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                    items(notasIncrustadas) { nota ->
                        FilaNotaIncrustada(nota) { alIrA(nota.pagina) }
                        ReglaFina()
                    }
                }
            }
        }
    }
}

@Composable
private fun FilaAnotacion(
    anotacion: Anotacion,
    alIr: () -> Unit,
    alBorrar: () -> Unit,
    alEditar: () -> Unit,
    /** Nulos cuando no hay cita que llevarse: un subrayado de una página escaneada. */
    alCopiar: (() -> Unit)? = null,
    alCompartir: (() -> Unit)? = null,
) {
    // «Copiada» unos segundos después de copiar. Android 13 enseña su propio
    // aviso, pero los anteriores no dicen nada y no se sabría si ha funcionado.
    var copiada by remember(anotacion.id) { mutableStateOf(false) }
    LaunchedEffect(copiada) {
        if (copiada) {
            delay(2000)
            copiada = false
        }
    }

    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = alIr)
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier
                .size(width = 4.dp, height = 40.dp)
                .background(colorDe(anotacion.color)),
        )
        Column(
            Modifier
                .weight(1f)
                .padding(horizontal = 12.dp),
        ) {
            Text(
                if (anotacion.tipo == TipoAnotacion.HIGHLIGHT) "Subrayado · página ${anotacion.pagina}"
                else "Nota · página ${anotacion.pagina}",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            val cuerpo = anotacion.texto ?: anotacion.cita
            if (!cuerpo.isNullOrBlank()) {
                Text(cuerpo, style = MaterialTheme.typography.bodyMedium, maxLines = 4)
            }
        }
        Column {
            // Sólo las notas: un subrayado no tiene texto propio que corregir,
            // lo que dice es lo que pone en la página.
            if (anotacion.tipo == TipoAnotacion.NOTE) {
                Text(
                    "Editar",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier
                        .heightIn(min = 44.dp)
                        .clickable(onClick = alEditar)
                        .padding(horizontal = 10.dp, vertical = 12.dp),
                )
            }
            if (alCopiar != null) {
                Text(
                    if (copiada) "Copiada" else "Copiar",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier
                        .heightIn(min = 44.dp)
                        .clickable {
                            alCopiar()
                            copiada = true
                        }
                        .padding(horizontal = 10.dp, vertical = 12.dp),
                )
            }
            if (alCompartir != null) {
                Text(
                    "Compartir",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurface,
                    modifier = Modifier
                        .heightIn(min = 44.dp)
                        .clickable(onClick = alCompartir)
                        .padding(horizontal = 10.dp, vertical = 12.dp),
                )
            }
            Text(
                "Borrar",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.primary,
                modifier = Modifier
                    .heightIn(min = 44.dp)
                    .clickable(onClick = alBorrar)
                    .padding(horizontal = 10.dp, vertical = 12.dp),
            )
        }
    }
}

/**
 * Manda un texto a otra aplicación con la hoja de compartir del sistema.
 *
 * Si no hay ninguna que lo acepte —un teléfono pelado, un perfil de trabajo
 * muy cerrado— no pasa nada: se queda donde estaba. Tirar la aplicación por
 * no poder compartir sería peor que no compartir.
 */
private fun compartirTexto(contexto: Context, texto: String, asunto: String? = null) {
    val envio = Intent(Intent.ACTION_SEND).apply {
        type = "text/plain"
        putExtra(Intent.EXTRA_TEXT, texto)
        if (asunto != null) putExtra(Intent.EXTRA_SUBJECT, asunto)
    }
    runCatching { contexto.startActivity(Intent.createChooser(envio, null)) }
}

/**
 * El porcentaje de zoom es también el menú «Vista».
 *
 * Es el número que dice cómo se está viendo la página, y por tanto donde se
 * busca cómo cambiarlo. Ahí van volver al ancho de la pantalla —con el zoom a
 * ocho aumentos, «−» son cinco toques— y el color del papel, que no tenía
 * dónde ir en una barra sin sitio.
 */
@Composable
private fun MenuVista(zoom: Float, papel: Papel, alZoom: (Float) -> Unit, alElegirPapel: (Papel) -> Unit) {
    var abierto by remember { mutableStateOf(false) }
    Box {
        Text(
            "${(zoom * 100).toInt()} %",
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier
                .heightIn(min = 44.dp)
                .clickable(onClickLabel = "Opciones de vista") { abierto = true }
                .padding(horizontal = 6.dp, vertical = 14.dp),
        )
        DropdownMenu(expanded = abierto, onDismissRequest = { abierto = false }) {
            DropdownMenuItem(
                text = { Text("Ajustar al ancho") },
                enabled = zoom > ZOOM_MINIMO,
                onClick = {
                    abierto = false
                    alZoom(ZOOM_MINIMO)
                },
            )
            ReglaFina()
            Papel.entries.forEach { opcion ->
                DropdownMenuItem(
                    text = {
                        Text(
                            when (opcion) {
                                Papel.BLANCO -> "Papel blanco"
                                Papel.SEPIA -> "Papel sepia"
                                Papel.NOCHE -> "Papel de noche"
                            },
                            // El elegido en rojo: el acento marca lo activo,
                            // como en el resto de la barra.
                            color = if (opcion == papel) MaterialTheme.colorScheme.primary else Color.Unspecified,
                        )
                    },
                    onClick = {
                        abierto = false
                        alElegirPapel(opcion)
                    },
                    modifier = Modifier.semantics { selected = opcion == papel },
                )
            }
        }
    }
}

/**
 * Una nota que traía el PDF.
 *
 * Sin botón de borrar y sin color: la barra lateral va en gris para que se vea
 * de un golpe que ésta no es de las nuestras. Se puede ir a su página, que es
 * lo único que tiene sentido hacer con ella.
 */
@Composable
private fun FilaNotaIncrustada(nota: NotaIncrustada, alIr: () -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = alIr)
            .padding(vertical = 12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier
                .size(width = 4.dp, height = 40.dp)
                .background(MaterialTheme.colorScheme.onSurfaceVariant),
        )
        Column(
            Modifier
                .weight(1f)
                .padding(horizontal = 12.dp),
        ) {
            Text(
                listOfNotNull("${nota.tipo} · página ${nota.pagina}", nota.autor).joinToString(" · "),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(nota.texto, style = MaterialTheme.typography.bodyMedium, maxLines = 6)
        }
    }
}

/**
 * Selector de color del subrayado. Los cuatro del lector web, sin más.
 *
 * Existía y no lo llamaba nadie, así que todo se subrayaba en amarillo. Vive
 * debajo del aviso del modo subrayado, que es el único momento en que el color
 * importa. 44 dp por lado: es un objetivo táctil, no una muestra.
 */
@Composable
fun SelectorColor(activo: ColorAnotacion, alElegir: (ColorAnotacion) -> Unit, modifier: Modifier = Modifier) {
    Row(modifier, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        ColorAnotacion.entries.forEach { color ->
            Box(
                Modifier
                    .size(44.dp)
                    .background(colorDe(color))
                    .clickable { alElegir(color) }
                    .semantics {
                        contentDescription = nombreDe(color)
                        selected = color == activo
                    },
            ) {
                if (color == activo) {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .height(4.dp)
                            .background(Color.Black),
                    )
                }
            }
        }
    }
}

private fun nombreDe(color: ColorAnotacion): String = when (color) {
    ColorAnotacion.YELLOW -> "Amarillo"
    ColorAnotacion.RED -> "Rojo"
    ColorAnotacion.GREEN -> "Verde"
    ColorAnotacion.BLUE -> "Azul"
}

/**
 * Ir a otro sitio del documento: a una página por su número, o a una entrada
 * del índice.
 *
 * Las dos cosas en el mismo diálogo porque son la misma pregunta —«¿a dónde
 * quieres ir?»— y porque la barra no tiene sitio para un control más.
 *
 * El número: teclado numérico y la página actual ya escrita, que es por donde
 * se empieza a contar. Lo que está fuera del documento no se acepta en vez de
 * recortarse: escribir 900 en un libro de 300 es una errata, y llevar a la
 * última página sin decir nada la esconde.
 *
 * El índice se pide al abrir el diálogo, no al abrir el libro: sale de la capa
 * de texto, y abrirla cuesta. La entrada en la que se está se marca en rojo,
 * que aquí significa «estás aquí».
 */
@Composable
fun DialogoIrAPagina(
    actual: Int,
    paginas: Int,
    indice: List<EntradaIndice>,
    indiceLeido: Boolean,
    indiceIlegible: Boolean,
    alPedirIndice: () -> Unit,
    alIr: (Int) -> Unit,
    alCancelar: () -> Unit,
    alVerMiniaturas: () -> Unit = {},
) {
    LaunchedEffect(Unit) { alPedirIndice() }

    var texto by remember { mutableStateOf(actual.toString()) }
    val numero = texto.toIntOrNull()
    val valido = numero != null && numero in 1..paginas
    val ir = { if (valido) alIr(numero!!) }

    // La última entrada que empieza en esta página o antes. El índice va en
    // orden de documento, así que es la sección en la que se está leyendo.
    val enCurso = remember(indice, actual) {
        indice.indexOfLast { it.pagina != null && it.pagina <= actual }
    }

    AlertDialog(
        onDismissRequest = alCancelar,
        title = { Text("Ir a…", style = MaterialTheme.typography.titleMedium) },
        text = {
            LazyColumn(Modifier.heightIn(max = 460.dp)) {
                item {
                    Box(
                        Modifier
                            .fillMaxWidth()
                            .background(MaterialTheme.colorScheme.surfaceVariant)
                            .padding(12.dp),
                    ) {
                        BasicTextField(
                            value = texto,
                            onValueChange = { nuevo -> texto = nuevo.filter(Char::isDigit).take(6) },
                            singleLine = true,
                            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number, imeAction = ImeAction.Go),
                            keyboardActions = KeyboardActions(onGo = { ir() }),
                            textStyle = TextStyle(
                                fontSize = MaterialTheme.typography.bodyLarge.fontSize,
                                color = MaterialTheme.colorScheme.onSurface,
                            ),
                            modifier = Modifier.fillMaxWidth(),
                        )
                    }
                    Text(
                        if (texto.isEmpty() || valido) "Página, de 1 a $paginas" else "Este documento tiene $paginas páginas",
                        style = MaterialTheme.typography.labelMedium,
                        color = if (texto.isEmpty() || valido) {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        } else {
                            MaterialTheme.colorScheme.primary
                        },
                        modifier = Modifier.padding(top = 8.dp),
                    )
                    // Las miniaturas, para cuando no se sabe el número y el
                    // documento no trae índice: un escaneado, sobre todo.
                    Text(
                        "Ver todas las páginas",
                        style = MaterialTheme.typography.labelLarge,
                        color = MaterialTheme.colorScheme.onSurface,
                        modifier = Modifier
                            .padding(top = 4.dp)
                            .heightIn(min = 44.dp)
                            .clickable(onClick = alVerMiniaturas)
                            .padding(vertical = 12.dp),
                    )
                    ReglaFina(Modifier.padding(vertical = 12.dp))
                    Text(
                        "Índice",
                        style = MaterialTheme.typography.titleSmall,
                        modifier = Modifier.padding(bottom = 4.dp),
                    )
                }

                if (indice.isEmpty()) {
                    item {
                        Text(
                            when {
                                !indiceLeido -> "Leyendo el documento…"
                                indiceIlegible ->
                                    "No se ha podido abrir el documento para leer su índice. " +
                                        "Suele pasar con los PDF protegidos con contraseña."
                                else -> "Este documento no trae índice."
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }

                items(indice.size) { posicion ->
                    val entrada = indice[posicion]
                    val destino = entrada.pagina
                    val activa = posicion == enCurso
                    Row(
                        Modifier
                            .fillMaxWidth()
                            .heightIn(min = 44.dp)
                            .clickable(enabled = destino != null) { destino?.let(alIr) }
                            // Sangría por nivel, con tope: pasado el cuarto, el
                            // título se quedaría en una columna de dos palabras.
                            .padding(start = (entrada.nivel.coerceAtMost(4) * 14).dp, top = 10.dp, bottom = 10.dp),
                        verticalAlignment = Alignment.Top,
                    ) {
                        Text(
                            entrada.titulo,
                            style = if (entrada.nivel == 0) {
                                MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold)
                            } else {
                                MaterialTheme.typography.bodyMedium
                            },
                            color = when {
                                activa -> MaterialTheme.colorScheme.primary
                                destino == null -> MaterialTheme.colorScheme.onSurfaceVariant
                                else -> MaterialTheme.colorScheme.onSurface
                            },
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                            modifier = Modifier.weight(1f),
                        )
                        if (destino != null) {
                            Text(
                                "$destino",
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(start = 12.dp),
                            )
                        }
                    }
                }
            }
        },
        confirmButton = { TextButton(onClick = ir, enabled = valido) { Text("Ir a la página") } },
        dismissButton = { TextButton(onClick = alCancelar) { Text("Cancelar") } },
    )
}

/**
 * La barra del lector mientras se busca. Sustituye a la normal y no se
 * esconde: es donde están el campo, el contador y el paso de un resultado al
 * siguiente, y sin ella no habría cómo salir de la búsqueda.
 *
 * Se busca al pulsar la tecla de buscar del teclado, **no a cada letra**:
 * recorrer un libro de trescientas páginas por cada pulsación sería tirar la
 * batería para enseñar resultados de «ca», «cas» y «casa» que nadie ha pedido.
 */
@Composable
fun BarraBusqueda(
    busqueda: EstadoBusqueda,
    alBuscar: (String) -> Unit,
    alCerrar: () -> Unit,
    alAnterior: () -> Unit,
    alSiguiente: () -> Unit,
    alVerLista: () -> Unit,
) {
    var texto by remember { mutableStateOf(busqueda.consulta) }
    val foco = remember { FocusRequester() }
    // Al abrirla sin nada escrito, el teclado sale solo: se abre para escribir.
    LaunchedEffect(Unit) { if (busqueda.consulta.isEmpty()) foco.requestFocus() }

    val hay = busqueda.resultados.isNotEmpty()

    Column(Modifier.background(MaterialTheme.colorScheme.surface)) {
        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            ControlTexto("Cerrar", alCerrar)
            Box(
                Modifier
                    .weight(1f)
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            ) {
                BasicTextField(
                    value = texto,
                    onValueChange = { texto = it },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                    keyboardActions = KeyboardActions(onSearch = { alBuscar(texto) }),
                    // 16 sp como mínimo en lo que se escribe, como en todo el sitio.
                    textStyle = TextStyle(
                        fontSize = MaterialTheme.typography.bodyLarge.fontSize,
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .focusRequester(foco)
                        .semantics { contentDescription = "Buscar en el documento" },
                )
            }
            ControlTexto("Buscar", { alBuscar(texto) })
        }

        Row(
            Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                resumenDe(busqueda),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 2,
                modifier = Modifier
                    .weight(1f)
                    .padding(horizontal = 10.dp),
            )
            if (hay) {
                ControlTexto("Lista", alVerLista)
                ControlTexto("Anterior", alAnterior)
                ControlTexto("Siguiente", alSiguiente)
            }
        }

        ReglaGruesa()
    }
}

/** Una línea que dice qué está pasando con la búsqueda, y sólo una. */
private fun resumenDe(b: EstadoBusqueda): String {
    val n = b.resultados.size
    val cuantos = when (n) {
        0 -> "ningún resultado"
        1 -> "1 resultado"
        else -> "$n resultados"
    }
    return when {
        b.ilegible -> "No se ha podido abrir el documento para buscar en él."
        b.consulta.isEmpty() -> "Escribe lo que buscas y pulsa «Buscar»."
        b.total > 0 && b.revisadas == 0 && !b.buscando -> "Escribe al menos $MINIMO_BUSQUEDA letras."
        b.buscando -> "Buscando… página ${b.revisadas} de ${b.total} · $cuantos"
        b.sinTexto -> "Este documento no lleva texto: es una imagen escaneada, y en una imagen no se puede buscar."
        b.truncada -> "Más de $MAX_RESULTADOS resultados: se enseñan los primeros. Afina la búsqueda."
        n == 0 -> "Sin resultados para «${b.consulta}»."
        b.actual >= 0 -> "${b.actual + 1} de $cuantos"
        else -> cuantos.replaceFirstChar { it.uppercase() }
    }
}

/**
 * Todos los resultados, con su contexto, para elegir a cuál ir.
 *
 * Lo encontrado va en negrita y no en rojo: en una lista de cincuenta, el rojo
 * en cada línea dejaría de significar nada. El rojo es para el que se está
 * mirando, que es uno.
 */
@Composable
fun DialogoResultados(
    busqueda: EstadoBusqueda,
    alElegir: (Int) -> Unit,
    alCerrar: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = alCerrar,
        title = { Text("«${busqueda.consulta}»", style = MaterialTheme.typography.titleMedium, maxLines = 1) },
        text = {
            LazyColumn(Modifier.heightIn(max = 460.dp)) {
                items(busqueda.resultados.size) { posicion ->
                    val resultado = busqueda.resultados[posicion]
                    val actual = posicion == busqueda.actual
                    Column(
                        Modifier
                            .fillMaxWidth()
                            .clickable { alElegir(posicion) }
                            .padding(vertical = 10.dp),
                    ) {
                        Text(
                            "Página ${resultado.pagina}",
                            style = MaterialTheme.typography.labelMedium,
                            color = if (actual) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                        Text(
                            buildAnnotatedString {
                                if (resultado.antes.isNotEmpty()) {
                                    append(resultado.antes)
                                    append(" ")
                                }
                                withStyle(SpanStyle(fontWeight = FontWeight.ExtraBold)) { append(resultado.encontrado) }
                                if (resultado.despues.isNotEmpty()) {
                                    append(" ")
                                    append(resultado.despues)
                                }
                            },
                            style = MaterialTheme.typography.bodyMedium,
                            maxLines = 3,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                    ReglaFina()
                }
            }
        },
        confirmButton = { TextButton(onClick = alCerrar) { Text("Cerrar") } },
    )
}

@Composable
internal fun DialogoNota(
    titulo: String,
    alGuardar: (String) -> Unit,
    alCancelar: () -> Unit,
    /** El texto con el que se abre: vacío para una nota nueva, el suyo al editar. */
    inicial: String = "",
) {
    var texto by remember { mutableStateOf(inicial) }

    AlertDialog(
        onDismissRequest = alCancelar,
        title = { Text(titulo, style = MaterialTheme.typography.titleMedium) },
        text = {
            Box(
                Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surfaceVariant)
                    .padding(12.dp),
            ) {
                BasicTextField(
                    value = texto,
                    onValueChange = { texto = it },
                    // 16 sp mínimo en lo que se escribe: por debajo, el teclado
                    // de iOS amplía la página y en Android se lee mal igual.
                    textStyle = TextStyle(
                        fontSize = MaterialTheme.typography.bodyLarge.fontSize,
                        color = MaterialTheme.colorScheme.onSurface,
                    ),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(120.dp),
                )
            }
        },
        confirmButton = { TextButton(onClick = { alGuardar(texto) }) { Text("Guardar") } },
        dismissButton = { TextButton(onClick = alCancelar) { Text("Cancelar") } },
    )
}
