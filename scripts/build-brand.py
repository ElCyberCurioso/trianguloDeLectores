#!/usr/bin/env python3
"""
Prepara los recursos de marca a partir de `triangulo_brand.zip`.

Se ejecuta **una sola vez** (o cuando cambie la marca) y el resultado se
versiona en `public/`. No forma parte del build: requiere Pillow, que no es
dependencia del proyecto.

    pip install Pillow
    python3 scripts/build-brand.py triangulo_brand.zip

Qué arregla del pack original:

1. **Neblina blanca**: los PNG "transparentes" traen un velo blanco a alpha 24
   sobre todo el lienzo. Sobre el tema oscuro se vería como un rectángulo gris.
   Se elimina todo lo que esté por debajo de alpha 40.
2. **Encuadre**: el icono ocupa sólo la esquina superior izquierda de su lienzo
   de 1024 px. Se recorta al contenido real y se recentra.
3. **Contraste en tema oscuro**: la tinta de la marca es azul marino, invisible
   sobre #0f1115. Se genera una variante clara que sustituye el azul por marfil
   y **conserva el dorado**, en vez de invertir la imagen (que volvería el
   dorado azul).
"""
from __future__ import annotations

import sys
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
DESTINO_MARCA = RAIZ / "public" / "assets" / "brand"
DESTINO_PUBLICO = RAIZ / "public"

# Paleta tomada de los propios ficheros (ver README de la marca).
TINTA = (13, 26, 38)            # azul marino del logotipo
MARFIL = (244, 239, 228)        # sustituto de la tinta en tema oscuro
ALPHA_MINIMA = 40               # por debajo de esto es la neblina, no el dibujo


def limpiar(img: Image.Image) -> Image.Image:
    """Elimina el velo blanco de fondo conservando el dibujo y sus bordes."""
    img = img.convert("RGBA")
    pixeles = img.load()
    ancho, alto = img.size
    for y in range(alto):
        for x in range(ancho):
            r, g, b, a = pixeles[x, y]
            if a < ALPHA_MINIMA:
                pixeles[x, y] = (0, 0, 0, 0)
    return img


def recortar(img: Image.Image, margen: int = 0) -> Image.Image:
    """Recorta al contenido visible, con un margen opcional."""
    caja = img.getbbox()
    if not caja:
        return img
    izq, arr, der, aba = caja
    izq = max(0, izq - margen)
    arr = max(0, arr - margen)
    der = min(img.width, der + margen)
    aba = min(img.height, aba + margen)
    return img.crop((izq, arr, der, aba))


def es_dorado(r: int, g: int, b: int) -> bool:
    """Detecta el acento dorado: cálido y con el azul claramente por debajo."""
    return r > 110 and r - b > 35 and g > 70


def variante_clara(img: Image.Image) -> Image.Image:
    """
    Adapta el logotipo al tema oscuro.

    No se invierte la imagen —eso volvería azul el dorado— ni se recolorea píxel
    a píxel: los originales son una rasterización con ruido JPEG, y cualquier
    mapeo de color convierte ese ruido en puntos visibles.

    Lo que se transforma es el **alfa**: la tinta pasa a marfil totalmente
    opaco y el papel blanco pasa a transparente, dejando ver el fondo oscuro de
    la página. El ruido claro dentro de los trazos queda ligeramente
    translúcido en vez de convertirse en suciedad. El dorado se respeta.
    """
    img = img.convert("RGBA")
    salida = Image.new("RGBA", img.size)
    origen = img.load()
    destino = salida.load()
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = origen[x, y]
            if a == 0:
                continue
            if es_dorado(r, g, b):
                destino[x, y] = (min(255, r + 22), min(255, g + 20), min(255, b + 12), a)
                continue
            # luz 0 = tinta, 1 = papel. La opacidad es su inverso, con una
            # curva suave para que los bordes antialiased no se vean duros.
            luz = (r + g + b) / 765
            opacidad = max(0.0, 1.0 - luz * 1.15) ** 0.85
            nueva_alpha = int(a * opacidad)
            if nueva_alpha <= 2:
                continue
            destino[x, y] = (*MARFIL, nueva_alpha)
    return salida


def cuadrar(img: Image.Image, relleno: float = 0.08) -> Image.Image:
    """Centra el dibujo en un lienzo cuadrado con aire alrededor."""
    recortada = recortar(img)
    lado = int(max(recortada.size) * (1 + relleno * 2))
    lienzo = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    lienzo.paste(
        recortada,
        ((lado - recortada.width) // 2, (lado - recortada.height) // 2),
        recortada,
    )
    return lienzo


def con_placa(marca: Image.Image, lado: int = 512) -> Image.Image:
    """
    Icono de aplicación: la marca sobre una placa marfil de esquinas redondeadas.

    Hace falta porque la tinta de la marca es azul marino: sobre la barra de
    pestañas oscura de un navegador desaparecería. La placa garantiza contraste
    en cualquier contexto, y además Apple y los manifiestos PWA exigen un icono
    opaco (uno transparente se renderiza sobre negro).
    """
    lienzo = Image.new("RGBA", (lado, lado), (0, 0, 0, 0))
    radio = int(lado * 0.22)
    ImageDraw.Draw(lienzo).rounded_rectangle([0, 0, lado - 1, lado - 1], radius=radio, fill=(*MARFIL, 255))

    interior = int(lado * 0.74)
    dibujo = recortar(marca)
    escala = interior / max(dibujo.size)
    dibujo = dibujo.resize((max(1, round(dibujo.width * escala)), max(1, round(dibujo.height * escala))), Image.LANCZOS)
    lienzo.paste(dibujo, ((lado - dibujo.width) // 2, (lado - dibujo.height) // 2), dibujo)
    return lienzo


def guardar(img: Image.Image, ruta: Path, ancho: int | None = None, alto: int | None = None) -> None:
    copia = img
    if ancho or alto:
        if ancho and not alto:
            alto = max(1, round(img.height * ancho / img.width))
        elif alto and not ancho:
            ancho = max(1, round(img.width * alto / img.height))
        copia = img.resize((ancho, alto), Image.LANCZOS)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    copia.save(ruta, optimize=True)
    print(f"  {ruta.relative_to(RAIZ)}  {copia.width}x{copia.height}  {ruta.stat().st_size // 1024} kB")


def main() -> int:
    if len(sys.argv) < 2:
        print("Uso: python3 scripts/build-brand.py <triangulo_brand.zip>")
        return 1

    zip_path = Path(sys.argv[1])
    if not zip_path.exists():
        print(f"No se encuentra {zip_path}")
        return 1

    temporal = RAIZ / ".wrangler" / "brand-src"
    temporal.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        z.extractall(temporal)

    origen = next(temporal.glob("**/logo-principal-transparent.png")).parent
    print(f"Origen: {origen}")

    # --- logotipo completo (triángulo + palabra) --------------------------
    print("\nLogotipo completo")
    principal = recortar(limpiar(Image.open(origen / "logo-principal-transparent.png")))
    guardar(principal, DESTINO_MARCA / "logo.png", ancho=640)
    guardar(variante_clara(principal), DESTINO_MARCA / "logo-light.png", ancho=640)

    # --- lockup horizontal (cabecera y pie) -------------------------------
    print("\nLockup horizontal")
    lockup = recortar(limpiar(Image.open(origen / "logo-footer-transparent.png")))
    guardar(lockup, DESTINO_MARCA / "wordmark.png", ancho=720)
    guardar(variante_clara(lockup), DESTINO_MARCA / "wordmark-light.png", ancho=720)

    # --- marca suelta (icono) ---------------------------------------------
    print("\nMarca suelta")
    marca = cuadrar(limpiar(Image.open(origen / "icon-1024.png")))
    guardar(marca, DESTINO_MARCA / "mark.png", ancho=512)
    guardar(variante_clara(marca), DESTINO_MARCA / "mark-light.png", ancho=512)

    # --- iconos de navegador y aplicación ---------------------------------
    print("\nIconos")
    placa = con_placa(marca)
    guardar(placa, DESTINO_PUBLICO / "apple-touch-icon.png", ancho=180)
    guardar(placa, DESTINO_PUBLICO / "icon-192.png", ancho=192)
    guardar(placa, DESTINO_PUBLICO / "icon-512.png", ancho=512)
    guardar(marca, DESTINO_MARCA / "mark-32.png", ancho=32)

    # El .ico se regenera desde la marca ya recentrada: el del pack original
    # arrastra el descuadre y la neblina.
    ico = DESTINO_PUBLICO / "favicon.ico"
    placa.save(ico, sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
    print(f"  {ico.relative_to(RAIZ)}  16/32/48/64  {ico.stat().st_size // 1024} kB")

    # --- imagen social -----------------------------------------------------
    print("\nImagen social")
    og = Image.open(origen / "social-og-1200x630.jpg").convert("RGB")
    og.save(DESTINO_MARCA / "og-default.jpg", quality=82, optimize=True, progressive=True)
    print(f"  assets/brand/og-default.jpg  {og.width}x{og.height}")
    og_claro = Image.open(origen / "social-og-light-1200x630.jpg").convert("RGB")
    og_claro.save(DESTINO_MARCA / "og-light.jpg", quality=82, optimize=True, progressive=True)
    print(f"  assets/brand/og-light.jpg  {og_claro.width}x{og_claro.height}")

    print("\nListo.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
