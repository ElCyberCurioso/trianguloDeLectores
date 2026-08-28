#!/usr/bin/env python3
"""
Genera los iconos de navegador y de aplicación a partir de la marca
«1C · Tres reglas» del brand kit.

La marca en el sitio es SVG en línea (`src/server/views/components/brand.tsx`):
no hay ficheros que generar para la web. Lo único que sí necesita mapa de bits
es el favicon y los iconos de aplicación, porque ni los navegadores ni los
manifiestos PWA aceptan otra cosa.

Regla del brand kit: el isotipo va **en caja de tinta**, nunca sobre fondo
claro — a 16 px las reglas necesitan el contraste máximo.

    python3 scripts/build-brand.py
"""

from pathlib import Path
from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
DESTINO = RAIZ / "public"

TINTA = (32, 30, 29)
HUESO = (243, 242, 242)
ACENTO = (236, 48, 19)

# Proporciones fijas: 100 / 66 / 33 de ancho, grosor = 1/5 del alto del bloque,
# hueco = 0,6 x grosor. La tercera regla es la única roja.
ANCHOS = (1.0, 0.66, 0.33)


def isotipo(lado: int, margen: float = 0.22) -> Image.Image:
    """El isotipo dentro de su caja de tinta, cuadrada, del lado pedido."""
    lienzo = Image.new("RGBA", (lado, lado), (*TINTA, 255))
    dibujo = ImageDraw.Draw(lienzo)

    util = lado * (1 - margen * 2)
    grosor = util / 5 * 0.62          # el bloque son 3 reglas y 2 huecos
    hueco = grosor * 0.6
    alto = grosor * 3 + hueco * 2
    x0 = (lado - util) / 2
    y0 = (lado - alto) / 2

    for i, proporcion in enumerate(ANCHOS):
        y = y0 + i * (grosor + hueco)
        color = ACENTO if i == 2 else HUESO
        # Sin puntas redondeadas: rectángulos rectos.
        dibujo.rectangle([x0, y, x0 + util * proporcion, y + grosor], fill=(*color, 255))

    return lienzo


def og(ancho: int = 1200, alto: int = 630) -> Image.Image:
    """Imagen por omisión para redes: caja de tinta con el isotipo a la izquierda."""
    lienzo = Image.new("RGB", (ancho, alto), TINTA)
    dibujo = ImageDraw.Draw(lienzo)

    util = ancho * 0.42
    grosor = 34
    hueco = grosor * 0.6
    x0 = ancho * 0.08
    y0 = alto * 0.36

    for i, proporcion in enumerate(ANCHOS):
        y = y0 + i * (grosor + hueco)
        color = ACENTO if i == 2 else HUESO
        dibujo.rectangle([x0, y, x0 + util * proporcion, y + grosor], fill=color)

    return lienzo


def main() -> None:
    # Favicon multitamaño: 16, 32, 48 en un solo .ico.
    iconos = [isotipo(lado, margen=0.16 if lado <= 32 else 0.22) for lado in (16, 32, 48)]
    iconos[0].save(DESTINO / "favicon.ico", format="ICO", sizes=[(16, 16), (32, 32), (48, 48)])

    isotipo(180).save(DESTINO / "apple-touch-icon.png")
    isotipo(192).save(DESTINO / "icon-192.png")
    isotipo(512).save(DESTINO / "icon-512.png")
    og().save(DESTINO / "assets" / "brand" / "og-default.jpg", quality=90)

    print("iconos y tarjeta social generados desde la marca 1C")


if __name__ == "__main__":
    main()
