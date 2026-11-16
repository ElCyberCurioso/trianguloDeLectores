package site.triangulodelectores.lector.pdf

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * La búsqueda se prueba aquí por lo mismo que la selección: son palabras con
 * coordenadas y una cadena, nada de Android. Que PDFBox encuentre las
 * palabras de un PDF real es otra cosa y no se puede probar sin uno.
 */
class BusquedaTest {

    /** Dos renglones de tres palabras. */
    private val pagina = listOf(
        Palabra("El", 0.10f, 0.20f, 0.05f, 0.02f),
        Palabra("árbol", 0.16f, 0.20f, 0.10f, 0.02f),
        Palabra("crece.", 0.27f, 0.20f, 0.12f, 0.02f),
        Palabra("La", 0.10f, 0.24f, 0.04f, 0.02f),
        Palabra("casa", 0.15f, 0.24f, 0.08f, 0.02f),
        Palabra("ARDE", 0.24f, 0.24f, 0.10f, 0.02f),
    )

    @Test
    fun `sin tildes ni mayusculas`() {
        assertEquals("arbol", normalizarBusqueda("Árbol"))
        assertEquals("nino", normalizarBusqueda("NIÑO"))
        assertEquals("la casa", normalizarBusqueda("  la \n casa "))
    }

    @Test
    fun `las ligaduras se deshacen`() {
        // «ﬁ» es un solo carácter en el PDF y dos al buscar.
        assertEquals("fin", normalizarBusqueda("ﬁn"))
    }

    @Test
    fun `encuentra sin la tilde lo que la lleva`() {
        val resultados = buscarEnPagina(pagina, "arbol", 3)
        assertEquals(1, resultados.size)
        assertEquals(3, resultados[0].pagina)
        assertEquals("árbol", resultados[0].encontrado)
    }

    @Test
    fun `encuentra en mayusculas lo escrito en minusculas`() {
        assertEquals(1, buscarEnPagina(pagina, "arde", 1).size)
    }

    @Test
    fun `cruza de una palabra a otra en un solo rectangulo`() {
        val resultados = buscarEnPagina(pagina, "la casa", 1)
        assertEquals(1, resultados.size)
        val rects = resultados[0].rects
        assertEquals(1, rects.size)
        assertEquals(0.10f, rects[0].x, 0.0001f)
        assertEquals(0.23f, rects[0].x + rects[0].w, 0.0001f)
    }

    @Test
    fun `cruza de un renglon al siguiente en dos rectangulos`() {
        val resultados = buscarEnPagina(pagina, "crece. la", 1)
        assertEquals(1, resultados.size)
        assertEquals(2, resultados[0].rects.size)
    }

    @Test
    fun `la puntuacion cuenta`() {
        // «crece. La» lleva un punto en medio, y la puntuación se compara tal
        // cual: tildes y mayúsculas se ignoran, los signos no. Es una decisión
        // y no una limitación —saltarlos se puede—; este test está para que,
        // si se cambia, se cambie a propósito.
        assertTrue(buscarEnPagina(pagina, "crece la", 1).isEmpty())
    }

    @Test
    fun `un trozo de palabra resalta solo su parte`() {
        // «cas» son tres de las cuatro letras de «casa».
        val rect = buscarEnPagina(pagina, "cas", 1).single().rects.single()
        assertEquals(0.15f, rect.x, 0.0001f)
        assertEquals(0.06f, rect.w, 0.0001f)
    }

    @Test
    fun `cada aparicion sale por separado`() {
        // «casa» lleva dos «a»: dos resultados, los dos en la misma palabra.
        assertEquals(2, buscarEnPagina(pagina, "a", 1).count { it.encontrado == "casa" })
    }

    @Test
    fun `no se cuela una coincidencia a caballo de un espacio`() {
        // «el arbol»: «l a» cruza el espacio, «la» no debe encontrarse ahí.
        assertEquals(listOf("La"), buscarEnPagina(pagina, "la", 1).map { it.encontrado })
    }

    @Test
    fun `el contexto lleva el texto original`() {
        val resultado = buscarEnPagina(pagina, "casa", 1).single()
        assertTrue(resultado.antes.endsWith("La"))
        assertEquals("casa", resultado.encontrado)
        assertEquals("ARDE", resultado.despues)
    }

    @Test
    fun `nada que buscar o donde buscar`() {
        assertTrue(buscarEnPagina(pagina, "   ", 1).isEmpty())
        assertTrue(buscarEnPagina(emptyList(), "casa", 1).isEmpty())
        assertTrue(buscarEnPagina(pagina, "perro", 1).isEmpty())
    }
}
