# Recursos de marca

Generados desde `triangulo_brand.zip` con `python3 scripts/build-brand.py triangulo_brand.zip`.
No se editan a mano: si cambia la marca, se vuelve a ejecutar el script.

El pack original necesitaba tres arreglos, todos automatizados en el script:

1. **Neblina blanca.** Los PNG "transparentes" traían un velo blanco a alpha 24
   sobre todo el lienzo, que sobre el tema oscuro se veía como un rectángulo gris.
2. **Encuadre del icono.** `icon-1024.png` tenía el dibujo en la esquina superior
   izquierda, ocupando 84–676 de 1024 px. Se recorta al contenido y se recentra.
3. **Contraste en tema oscuro.** La tinta de la marca es azul marino: invisible
   sobre el fondo oscuro. Las variantes `-light` transforman el **alfa** (tinta →
   marfil opaco, papel → transparente) en vez de recolorear, porque el original
   es una rasterización con ruido JPEG y cualquier mapeo de color lo convertía en
   suciedad visible. El dorado se respeta en ambas variantes.

| Fichero | Uso |
|---|---|
| `logo.png` / `logo-light.png` | Logotipo completo (triángulo + palabra) |
| `wordmark.png` / `wordmark-light.png` | Lockup horizontal: cabecera y pie |
| `mark.png` / `mark-light.png` | Marca suelta, sin texto |
| `mark-32.png` | Contextos pequeños de interfaz |
| `og-default.jpg` / `og-light.jpg` | Imagen para redes sociales (1200×630) |

Sin sufijo = tinta azul marino, para fondos claros.
Sufijo `-light` = marfil, para fondos oscuros.

Los iconos de navegador y aplicación (`/favicon.ico`, `/apple-touch-icon.png`,
`/icon-192.png`, `/icon-512.png`) llevan una placa marfil de esquinas
redondeadas: la marca sola desaparecería en una barra de pestañas oscura, y
tanto Apple como los manifiestos PWA exigen un icono opaco.

**Paleta tomada de los propios ficheros**: tinta `#0d1a26`, dorado `#c8963e`,
marfil `#f4efe4`.
