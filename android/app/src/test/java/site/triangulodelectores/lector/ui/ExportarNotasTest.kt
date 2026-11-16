package site.triangulodelectores.lector.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import site.triangulodelectores.lector.data.local.Anotacion
import site.triangulodelectores.lector.data.local.ColorAnotacion
import site.triangulodelectores.lector.data.local.TipoAnotacion

class ExportarNotasTest {

    private fun anotacion(
        id: String,
        pagina: Int,
        tipo: TipoAnotacion = TipoAnotacion.HIGHLIGHT,
        cita: String? = null,
        texto: String? = null,
        creadoEn: Long = 0,
        borradoEn: Long? = null,
    ) = Anotacion(
        id = id,
        documentoId = "doc",
        tipo = tipo,
        pagina = pagina,
        rects = emptyList(),
        cita = cita,
        texto = texto,
        color = ColorAnotacion.YELLOW,
        creadoEn = creadoEn,
        actualizadoEn = creadoEn,
        borradoEn = borradoEn,
    )

    @Test
    fun `por orden de pagina y, dentro, por orden de escritura`() {
        val texto = notasEnMarkdown(
            titulo = "Rayuela",
            autor = "Julio Cortázar",
            anotaciones = listOf(
                anotacion("c", pagina = 12, cita = "segunda", creadoEn = 20),
                anotacion("a", pagina = 3, cita = "primera"),
                anotacion("b", pagina = 12, cita = "antes", creadoEn = 10),
            ),
            marcadores = emptyList(),
        )
        assertTrue(texto.startsWith("# Rayuela\n\nJulio Cortázar\n"))
        val orden = listOf("## Página 3", "> primera", "## Página 12", "> antes", "> segunda").map(texto::indexOf)
        assertFalse(orden.contains(-1))
        assertEquals(orden.sorted(), orden)
    }

    @Test
    fun `una cita de varios renglones lleva el signo en cada uno`() {
        val texto = notasEnMarkdown("T", null, listOf(anotacion("a", 1, cita = "uno\ndos")), emptyList())
        assertTrue(texto.contains("> uno\n> dos\n"))
    }

    @Test
    fun `la nota va como parrafo y el subrayado sin texto se nombra`() {
        val texto = notasEnMarkdown(
            "T",
            null,
            listOf(
                anotacion("n", 2, tipo = TipoAnotacion.NOTE, texto = "Volver aquí"),
                anotacion("z", 5),
            ),
            emptyList(),
        )
        assertTrue(texto.contains("## Página 2\n\nVolver aquí\n"))
        assertTrue(texto.contains("> (zona subrayada, sin texto)"))
    }

    @Test
    fun `lo borrado no se exporta`() {
        val texto = notasEnMarkdown("T", null, listOf(anotacion("a", 1, cita = "fuera", borradoEn = 5)), emptyList())
        assertFalse(texto.contains("fuera"))
    }

    @Test
    fun `los marcadores van ordenados y sin repetir`() {
        val texto = notasEnMarkdown("T", null, emptyList(), listOf(30, 4, 30))
        assertTrue(texto.contains("Páginas marcadas: 4, 30"))
    }

    @Test
    fun `una cita para compartir lleva obra y pagina`() {
        assertEquals(
            "«Andábamos sin buscarnos»\n— Rayuela, p. 7",
            citaParaCompartir("  Andábamos sin buscarnos ", "Rayuela", 7),
        )
    }
}
