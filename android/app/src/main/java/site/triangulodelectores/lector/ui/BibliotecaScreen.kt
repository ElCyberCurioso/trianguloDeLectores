package site.triangulodelectores.lector.ui

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import site.triangulodelectores.lector.data.remote.LibroDto
import site.triangulodelectores.lector.data.remote.LibroEnvioDto
import site.triangulodelectores.lector.data.remote.paraEnviar

/**
 * La biblioteca en papel.
 *
 * Es la mitad del proyecto que no son PDF: doscientas y pico fichas de libros
 * de estantería. Aquí se consultan y se mantienen, y se dan de alta de las dos
 * maneras que tiene sentido dar de alta un libro que tienes en la mano -- por
 * su ISBN, dejando que el servidor traiga la ficha, o a mano cuando no hay
 * ISBN que valga (una edición vieja, un cuadernillo, algo descatalogado).
 */
@Composable
fun BibliotecaScreen(modelo: BibliotecaViewModel, alVolver: () -> Unit) {
    val estado by modelo.estado.collectAsState()
    // Las portadas llegan sueltas y después de la lista: sin observar esto, la
    // fila ya compuesta no se enteraría de que su imagen ya está.
    val revision by modelo.revision.collectAsState()

    var menuAbierto by remember { mutableStateOf(false) }
    var editando by remember { mutableStateOf<LibroDto?>(null) }
    var creando by remember { mutableStateOf(false) }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
        contentColor = MaterialTheme.colorScheme.onBackground,
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing),
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(Modifier.weight(1f)) {
                    Text("Biblioteca", style = MaterialTheme.typography.titleMedium, maxLines = 1)
                    Text(
                        if (estado.cargando) "Cargando…" else "${estado.contadores.total} libros",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Text(
                    "Añadir",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .heightIn(min = 44.dp)
                        .clickable { creando = true }
                        .padding(horizontal = 10.dp, vertical = 12.dp),
                )
                Box {
                    Text(
                        "···",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.ExtraBold,
                        modifier = Modifier
                            .heightIn(min = 44.dp)
                            .clickable { menuAbierto = true }
                            .padding(horizontal = 14.dp, vertical = 10.dp),
                    )
                    DropdownMenu(expanded = menuAbierto, onDismissRequest = { menuAbierto = false }) {
                        ORDENES_BIBLIOTECA.forEach { (clave, etiqueta) ->
                            DropdownMenuItem(
                                text = {
                                    Text(
                                        if (estado.orden == clave) "· Ordenar por $etiqueta"
                                        else "Ordenar por $etiqueta",
                                    )
                                },
                                onClick = { menuAbierto = false; modelo.ordenarPor(clave) },
                            )
                        }
                        DropdownMenuItem(
                            text = { Text("Volver a la estantería") },
                            onClick = { menuAbierto = false; alVolver() },
                        )
                    }
                }
            }
            ReglaGruesa()

            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) {
                CampoBiblioteca(
                    etiqueta = "Buscar por título, autor o ISBN",
                    valor = estado.busqueda,
                    alCambiar = modelo::buscar,
                    tipo = KeyboardType.Text,
                )
                Spacer(Modifier.height(8.dp))
                Row(
                    Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    FiltroEstado("Todos", estado.estado == "ALL") { modelo.filtrarPor("ALL") }
                    ESTADOS_LIBRO.forEach { (clave, etiqueta) ->
                        FiltroEstado(etiqueta, estado.estado == clave) { modelo.filtrarPor(clave) }
                    }
                }
            }
            ReglaFina()

            estado.aviso?.let {
                Aviso(it, Modifier.padding(horizontal = 16.dp), acento = true)
                LaunchedEffect(it) { modelo.avisoVisto() }
            }

            if (estado.libros.isEmpty() && !estado.cargando) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("No hay nada aquí", style = MaterialTheme.typography.headlineSmall)
                    Text(
                        if (estado.busqueda.isBlank()) {
                            "La biblioteca está vacía, o este teléfono todavía no está emparejado."
                        } else {
                            "Ningún libro coincide con «${estado.busqueda}»."
                        },
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    BotonPrimario("Añadir un libro", { creando = true })
                }
            } else {
                LazyColumn(Modifier.fillMaxSize()) {
                    items(estado.libros, key = { it.id }) { libro ->
                        FilaLibro(
                            libro = libro,
                            portada = { revision.let { _ -> modelo.portada(libro) } },
                            alPulsar = { editando = libro },
                        )
                        ReglaFina()
                    }
                }
            }
        }
    }

    if (creando || editando != null) {
        EditorLibro(
            modelo = modelo,
            libro = editando,
            alCerrar = { creando = false; editando = null },
        )
    }
}

/** Chip de filtro. En rojo el activo: el acento significa algo. */
@Composable
private fun FiltroEstado(etiqueta: String, activo: Boolean, alPulsar: () -> Unit) {
    Text(
        etiqueta,
        style = MaterialTheme.typography.labelMedium,
        color = if (activo) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier
            .heightIn(min = 44.dp)
            .clickable(onClick = alPulsar)
            .padding(horizontal = 10.dp, vertical = 14.dp),
    )
}

/**
 * Una ficha en la lista.
 *
 * Portada 2:3, como en el sitio, y **en color**: es identidad de la obra. Lo
 * que no tiene portada lleva marcador gris, nunca un hueco que baile.
 */
@Composable
private fun FilaLibro(
    libro: LibroDto,
    portada: () -> android.graphics.Bitmap?,
    alPulsar: () -> Unit,
) {
    Row(
        Modifier
            .fillMaxWidth()
            .clickable(onClick = alPulsar)
            .padding(16.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(
            Modifier
                .width(44.dp)
                .aspectRatio(2f / 3f)
                .background(MaterialTheme.colorScheme.surfaceVariant),
        ) {
            portada()?.let {
                Image(
                    bitmap = it.asImageBitmap(),
                    contentDescription = null,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                )
            }
        }

        Column(
            Modifier
                .weight(1f)
                .padding(start = 12.dp),
        ) {
            Text(libro.title, style = MaterialTheme.typography.titleSmall)
            libro.authors?.let {
                Text(
                    it,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(4.dp))
            Text(
                listOfNotNull(
                    etiquetaEstado(libro.status),
                    libro.publishedYear?.toString(),
                    libro.location,
                ).joinToString(" · "),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}

/**
 * Alta y edición.
 *
 * El alta por ISBN no es otro camino: es este mismo con los campos ya rellenos
 * por lo que devuelve el servidor. Lo que llega se puede corregir antes de
 * guardar, que es lo que hace falta cuando Open Library trae el título en otro
 * idioma o sin subtítulo.
 */
@Composable
private fun EditorLibro(modelo: BibliotecaViewModel, libro: LibroDto?, alCerrar: () -> Unit) {
    val alcance = rememberCoroutineScope()
    val partida = remember(libro) { libro?.paraEnviar() ?: LibroEnvioDto(title = "") }

    var isbn by remember(libro) { mutableStateOf(partida.isbn13) }
    var titulo by remember(libro) { mutableStateOf(partida.title) }
    var subtitulo by remember(libro) { mutableStateOf(partida.subtitle) }
    var autores by remember(libro) { mutableStateOf(partida.authors) }
    var editorial by remember(libro) { mutableStateOf(partida.publisher) }
    var anio by remember(libro) { mutableStateOf(partida.publishedYear?.toString() ?: "") }
    var paginas by remember(libro) { mutableStateOf(partida.pageCount?.toString() ?: "") }
    var idioma by remember(libro) { mutableStateOf(partida.language) }
    var ubicacion by remember(libro) { mutableStateOf(partida.location) }
    var estadoLibro by remember(libro) { mutableStateOf(partida.status) }
    var nota by remember(libro) { mutableStateOf(partida.rating?.toString() ?: "") }
    var notas by remember(libro) { mutableStateOf(partida.notes) }
    var portadaUrl by remember(libro) { mutableStateOf("") }

    var buscando by remember { mutableStateOf(false) }
    var avisoIsbn by remember { mutableStateOf<String?>(null) }
    var guardando by remember { mutableStateOf(false) }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
        contentColor = MaterialTheme.colorScheme.onBackground,
    ) {
        Column(
            Modifier
                .fillMaxSize()
                .windowInsetsPadding(WindowInsets.safeDrawing)
                .verticalScroll(rememberScrollState()),
        ) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (libro == null) "Añadir libro" else "Editar libro",
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.weight(1f),
                )
                Text(
                    "Cancelar",
                    style = MaterialTheme.typography.labelLarge,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier
                        .heightIn(min = 44.dp)
                        .clickable(onClick = alCerrar)
                        .padding(horizontal = 8.dp, vertical = 12.dp),
                )
            }
            ReglaGruesa()

            Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Por ISBN", style = MaterialTheme.typography.titleMedium)
                Text(
                    "La consulta la hace el servidor, no el teléfono: tu dirección no llega a " +
                        "Open Library, y la portada se guarda en la biblioteca en vez de enlazarse.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                CampoBiblioteca("ISBN", isbn, { isbn = it }, KeyboardType.Number)
                BotonSecundario(
                    if (buscando) "Buscando…" else "Traer datos del ISBN",
                    {
                        buscando = true
                        avisoIsbn = null
                        alcance.launch {
                            modelo.consultarIsbn(isbn)
                                .onSuccess { (borrador, duplicado) ->
                                    if (borrador != null) {
                                        if (borrador.title.isNotBlank()) titulo = borrador.title
                                        borrador.subtitle?.let { subtitulo = it }
                                        borrador.authors?.let { autores = it }
                                        borrador.publisher?.let { editorial = it }
                                        borrador.publishedYear?.let { anio = it.toString() }
                                        borrador.pageCount?.let { paginas = it.toString() }
                                        borrador.language?.let { idioma = it }
                                        borrador.isbn13?.let { isbn = it }
                                        portadaUrl = borrador.coverUrl.orEmpty()
                                    }
                                    avisoIsbn = when {
                                        duplicado != null ->
                                            "Ojo: ese ISBN ya está en la biblioteca como «$duplicado»."
                                        borrador?.title.isNullOrBlank() ->
                                            "Open Library no sabe nada de ese ISBN. Rellena la ficha a mano."
                                        else -> "Ficha traída. Revísala antes de guardar."
                                    }
                                }
                                .onFailure { avisoIsbn = it.message ?: "No se ha podido consultar el ISBN." }
                            buscando = false
                        }
                    },
                    activo = !buscando && isbn.isNotBlank(),
                )
                avisoIsbn?.let { Aviso(it, acento = true) }

                ReglaGruesa()
                Text("La ficha", style = MaterialTheme.typography.titleMedium)
                CampoBiblioteca("Título", titulo, { titulo = it }, KeyboardType.Text)
                CampoBiblioteca("Subtítulo", subtitulo, { subtitulo = it }, KeyboardType.Text)
                CampoBiblioteca("Autores", autores, { autores = it }, KeyboardType.Text)
                CampoBiblioteca("Editorial", editorial, { editorial = it }, KeyboardType.Text)
                CampoBiblioteca("Año", anio, { anio = it.filter(Char::isDigit) }, KeyboardType.Number)
                CampoBiblioteca("Páginas", paginas, { paginas = it.filter(Char::isDigit) }, KeyboardType.Number)
                CampoBiblioteca("Idioma", idioma, { idioma = it }, KeyboardType.Text)
                CampoBiblioteca("Dónde está", ubicacion, { ubicacion = it }, KeyboardType.Text)
                CampoBiblioteca("Nota del 0 al 10", nota, { nota = it.filter(Char::isDigit) }, KeyboardType.Number)

                Text(
                    "Estado",
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Row(
                    Modifier.horizontalScroll(rememberScrollState()),
                    horizontalArrangement = Arrangement.spacedBy(4.dp),
                ) {
                    ESTADOS_LIBRO.forEach { (clave, etiqueta) ->
                        FiltroEstado(etiqueta, estadoLibro == clave) { estadoLibro = clave }
                    }
                }

                CampoBiblioteca("Notas", notas, { notas = it }, KeyboardType.Text)

                ReglaFina()
                BotonPrimario(
                    if (guardando) "Guardando…" else "Guardar",
                    {
                        guardando = true
                        modelo.guardar(
                            libro?.id,
                            LibroEnvioDto(
                                title = titulo.trim(),
                                isbn13 = isbn.trim(),
                                subtitle = subtitulo.trim(),
                                authors = autores.trim(),
                                publisher = editorial.trim(),
                                publishedYear = anio.toIntOrNull(),
                                pageCount = paginas.toIntOrNull(),
                                language = idioma.trim(),
                                location = ubicacion.trim(),
                                status = estadoLibro,
                                rating = nota.toIntOrNull()?.coerceIn(0, 10),
                                notes = notas.trim(),
                                coverUrl = portadaUrl,
                            ),
                        ) { bien ->
                            guardando = false
                            if (bien) alCerrar()
                        }
                    },
                    Modifier.fillMaxWidth(),
                    activo = !guardando && titulo.isNotBlank(),
                )

                if (libro != null) {
                    BotonSecundario("Borrar de la biblioteca", {
                        modelo.borrar(libro)
                        alCerrar()
                    })
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}

/**
 * Campo de texto.
 *
 * 16 sp de mínimo y 48 dp de alto, como en el resto: por debajo de eso el
 * sistema amplía la vista al enfocar y el objetivo táctil se queda corto.
 */
@Composable
private fun CampoBiblioteca(
    etiqueta: String,
    valor: String,
    alCambiar: (String) -> Unit,
    tipo: KeyboardType,
) {
    Column {
        Text(
            etiqueta,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier.height(4.dp))
        Box(
            Modifier
                .fillMaxWidth()
                .height(48.dp)
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .padding(horizontal = 12.dp),
            contentAlignment = Alignment.CenterStart,
        ) {
            BasicTextField(
                value = valor,
                onValueChange = alCambiar,
                singleLine = true,
                textStyle = TextStyle(
                    fontSize = MaterialTheme.typography.bodyLarge.fontSize,
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                keyboardOptions = KeyboardOptions(keyboardType = tipo, imeAction = ImeAction.Next),
                modifier = Modifier.fillMaxWidth(),
            )
        }
    }
}
