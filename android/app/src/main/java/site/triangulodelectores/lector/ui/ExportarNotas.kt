package site.triangulodelectores.lector.ui

import site.triangulodelectores.lector.data.local.Anotacion
import site.triangulodelectores.lector.data.local.TipoAnotacion

/*
 * Lo escrito sobre un documento, como texto que se lleva a otra parte.
 *
 * Funciones puras y con tests: qué se exporta y en qué orden es lo que se puede
 * equivocar, y no necesita un teléfono para comprobarse. Mandarlo a otra
 * aplicación es cosa de la pantalla.
 */

/**
 * Todas las notas y subrayados de un documento en Markdown, por orden de página.
 *
 * Markdown porque es texto que se lee tal cual en un correo o en una nota del
 * teléfono, y que además entienden Obsidian, Notion o cualquier editor si se
 * pega allí. Las citas van como cita de Markdown —`>` en cada renglón, porque
 * una cita de varios renglones con el signo sólo en el primero deja de serlo
 * en el segundo— y las notas como párrafo.
 *
 * Dentro de una página, en el orden en que se escribieron: es el orden en que
 * se leyó, que es como se recuerdan.
 */
fun notasEnMarkdown(
    titulo: String,
    autor: String?,
    anotaciones: List<Anotacion>,
    marcadores: List<Int>,
): String = buildString {
    appendLine("# ${titulo.ifBlank { "Sin título" }}")
    if (!autor.isNullOrBlank()) {
        appendLine()
        appendLine(autor)
    }

    if (marcadores.isNotEmpty()) {
        appendLine()
        appendLine("Páginas marcadas: ${marcadores.distinct().sorted().joinToString(", ")}")
    }

    anotaciones
        .filter { it.borradoEn == null }
        .sortedWith(compareBy({ it.pagina }, { it.creadoEn }))
        .groupBy { it.pagina }
        .forEach { (pagina, deLaPagina) ->
            appendLine()
            appendLine("## Página $pagina")
            deLaPagina.forEach { anotacion ->
                val cita = anotacion.cita?.trim()
                val texto = anotacion.texto?.trim()
                when {
                    !cita.isNullOrEmpty() -> {
                        appendLine()
                        cita.lines().forEach { appendLine("> ${it.trim()}") }
                    }
                    // Un subrayado de una página escaneada no tiene texto: se
                    // dice que está, para que no parezca que se ha perdido.
                    anotacion.tipo == TipoAnotacion.HIGHLIGHT && texto.isNullOrEmpty() -> {
                        appendLine()
                        appendLine("> (zona subrayada, sin texto)")
                    }
                }
                if (!texto.isNullOrEmpty()) {
                    appendLine()
                    appendLine(texto)
                }
            }
        }
}.trimEnd() + "\n"

/**
 * Una cita lista para pegar o mandar: entre comillas angulares, con la obra y
 * la página debajo. Es como se cita en castellano, y sin la página una cita
 * suelta no hay forma de volver a encontrarla.
 */
fun citaParaCompartir(cita: String, titulo: String, pagina: Int): String =
    "«${cita.trim()}»\n— ${titulo.ifBlank { "Sin título" }}, p. $pagina"
