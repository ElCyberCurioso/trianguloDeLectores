package site.triangulodelectores.lector.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Las cuentas del encuadre, del zoom anclado y de la posición en páginas.
 *
 * Se prueban propiedades y no sólo valores: que el punto bajo el dedo no se
 * mueve, que lo guardado en vertical cae dentro del margen en horizontal, que
 * la barra abajo del todo es el final. Son las tres cosas que se rompieron en
 * el teléfono sin que nada avisara, y ninguna se ve sin un aparato salvo así.
 */
class EncuadreTest {

    private val delta = 0.001f

    @Test
    fun `sin zoom no hay margen`() {
        assertEquals(0f, margenEncuadre(1080, 1f), delta)
        assertEquals(2160f, margenEncuadre(1080, 3f), delta)
    }

    @Test
    fun `el encuadre se acota por los dos lados`() {
        assertEquals(0f, acotarEncuadre(50f, 1080, 2f), delta)
        assertEquals(-1080f, acotarEncuadre(-5000f, 1080, 2f), delta)
        assertEquals(-300f, acotarEncuadre(-300f, 1080, 2f), delta)
        // Con el zoom a uno el único sitio legal es el borde izquierdo.
        assertEquals(0f, acotarEncuadre(-300f, 1080, 1f), delta)
    }

    @Test
    fun `la fraccion del encuadre sobrevive al giro sin salirse del margen`() {
        val zoom = 3f
        // En vertical, pegado al tope izquierdo del margen.
        val fraccion = fraccionDeEncuadre(-margenEncuadre(1080, zoom), 1080, zoom)!!
        assertEquals((zoom - 1f) / zoom, fraccion, delta)

        // En horizontal, con otro ancho: cae justo en el tope, ni más ni menos.
        val horizontal = encuadreDeFraccion(fraccion, 2400, zoom)
        assertEquals(-margenEncuadre(2400, zoom), horizontal, 0.5f)
        assertEquals(horizontal, acotarEncuadre(horizontal, 2400, zoom), 0.5f)
    }

    @Test
    fun `sin hueco medido no hay fraccion que apuntar`() {
        // La composición nace con el ancho a cero; apuntar ahí borraría la
        // fracción guardada antes de reponerla.
        assertNull(fraccionDeEncuadre(0f, 0, 2f))
    }

    @Test
    fun `el punto bajo el dedo no se mueve al ampliar`() {
        val anterior = 2f
        val x = -400f
        val centroX = 600f
        val centroY = 900f
        val anclado = anclarZoom(anterior, 3f, centroX, centroY, x, 1080)!!

        // Coordenada del documento, sin ampliar, que hay bajo el centro.
        val antes = (centroX - x) / anterior
        val despues = (centroX - anclado.desplazamientoX) / anclado.zoom
        assertEquals(antes, despues, delta)

        // En vertical: lo que la lista tiene bajo el centro antes y después.
        assertEquals(centroY / anterior, anclado.deltaLista + centroY / anclado.zoom, delta)
    }

    @Test
    fun `en el tope del zoom no hay nada que hacer`() {
        assertNull(anclarZoom(ZOOM_MAXIMO, ZOOM_MAXIMO * 1.2f, 500f, 500f, -100f, 1080))
        assertNull(anclarZoom(ZOOM_MINIMO, ZOOM_MINIMO * 0.8f, 500f, 500f, 0f, 1080))
    }

    @Test
    fun `pasar del techo se recorta al techo`() {
        val anclado = anclarZoom(6f, 12f, 500f, 500f, -100f, 1080)!!
        assertEquals(ZOOM_MAXIMO, anclado.zoom, delta)
    }

    @Test
    fun `volver a zoom uno deja el documento pegado a la izquierda`() {
        val anclado = anclarZoom(2f, 1f, 900f, 300f, -800f, 1080)!!
        assertEquals(0f, anclado.desplazamientoX, delta)
    }

    // Tres páginas de 1000 px sobre un hueco de 1500.

    @Test
    fun `arriba del todo es el principio`() {
        val posicion = posicionEnPaginas(
            listOf(PaginaMedida(0, 0, 1000), PaginaMedida(1, 1000, 1000)),
            inicioHueco = 0,
            finHueco = 1500,
            paginas = 3,
        )!!
        assertEquals(0f, posicion.fraccion, delta)
        assertEquals(1.5f, posicion.visibles, delta)
    }

    @Test
    fun `abajo del todo es el final, no el principio de la ultima`() {
        // La tercera acaba justo en el borde de abajo del hueco.
        val posicion = posicionEnPaginas(
            listOf(PaginaMedida(1, -500, 1000), PaginaMedida(2, 500, 1000)),
            inicioHueco = 0,
            finHueco = 1500,
            paginas = 3,
        )!!
        assertEquals(1f, posicion.fraccion, delta)
    }

    @Test
    fun `un documento que cabe entero no tiene barra`() {
        assertNull(posicionEnPaginas(listOf(PaginaMedida(0, 0, 1000)), 0, 1500, 1))
        assertNull(posicionEnPaginas(emptyList(), 0, 1500, 3))
    }

    @Test
    fun `ir a una fraccion y volver a medirla da lo mismo`() {
        // A mitad de recorrido: 1,5 páginas por recorrer sobre 3, o sea
        // 0,75 páginas desde arriba.
        val (indice, dentro) = destinoDeFraccion(0.5f, 3, 1.5f)
        assertEquals(0, indice)
        assertEquals(0.75f, dentro, delta)

        // Con 750 px de la primera ocultos asoman las tres: 250 + 1000 + 250.
        // La lista da siempre todas las visibles, y hay que darlas todas.
        val offset = -(dentro * 1000).toInt()
        val medida = posicionEnPaginas(
            listOf(
                PaginaMedida(indice, offset, 1000),
                PaginaMedida(indice + 1, offset + 1000, 1000),
                PaginaMedida(indice + 2, offset + 2000, 1000),
            ),
            0,
            1500,
            3,
        )
        assertNotNull(medida)
        assertEquals(0.5f, medida!!.fraccion, 0.01f)
    }

    @Test
    fun `la fraccion pedida se acota`() {
        assertEquals(0 to 0f, destinoDeFraccion(-1f, 3, 1.5f))
        val (indice, dentro) = destinoDeFraccion(2f, 3, 1.5f)
        assertEquals(1, indice)
        assertEquals(0.5f, dentro, delta)
    }

    @Test
    fun `el rasterizado tiene techo y suelo`() {
        assertEquals(2160, anchoRasterDe(1080, 2f, 4096))
        assertEquals(4096, anchoRasterDe(1080, 8f, 4096))
        assertTrue(anchoRasterDe(0, 1f, 4096) >= 1)
    }

    // Mosaicos: hueco de 1000 × 2000 px, página de 1000 × 1400 sin ampliar.

    @Test
    fun `solo hay mosaico cuando la pagina se estira`() {
        assertFalse(seEstira(1000, 3f, 4096))
        assertTrue(seEstira(1000, 5f, 4096))
    }

    @Test
    fun `a zoom cuatro y sin encuadre se ve la esquina de arriba a la izquierda`() {
        // A cuatro aumentos la lista mide 2000 / 4 = 500 de alto visible.
        val region = regionVisible(0, 1400, 1000, 500, 0f, 4f)!!
        assertEquals(Region(0f, 0f, 250f, 500f), region)
    }

    @Test
    fun `el encuadre corre la region hacia la derecha`() {
        // Encuadre de -2000 px de pantalla: 500 px de lista ocultos a la izquierda.
        val region = regionVisible(0, 1400, 1000, 500, -2000f, 4f)!!
        assertEquals(500f, region.izquierda, delta)
        assertEquals(750f, region.derecha, delta)
    }

    @Test
    fun `una pagina que empieza mas arriba se ve desde dentro`() {
        // La página empieza 1000 px por encima del hueco: se ve de 1000 a 1400.
        val region = regionVisible(-1000, 1400, 1000, 500, 0f, 4f)!!
        assertEquals(1000f, region.arriba, delta)
        assertEquals(1400f, region.abajo, delta)
    }

    @Test
    fun `una pagina que no asoma no tiene region`() {
        assertNull(regionVisible(600, 1400, 1000, 500, 0f, 4f))
        assertNull(regionVisible(-1400, 1400, 1000, 500, 0f, 4f))
    }

    @Test
    fun `el trozo en pixeles nunca pasa del tamano de la pantalla y cubre el borde`() {
        val region = regionVisible(-333, 1400, 1000, 500, -1234f, 4f)!!
        val px = regionEnPixeles(region, 4f)
        // Redondeado hacia fuera: como mucho un píxel más por lado.
        assertTrue(px.ancho in 1000..1002)
        assertTrue(px.alto in 2000..2002)
        assertTrue(px.izquierda <= region.izquierda * 4f)
        assertTrue(px.derecha >= region.derecha * 4f)
    }
}
