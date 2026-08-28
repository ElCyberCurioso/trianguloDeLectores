# Recursos de marca

La identidad aprobada es **1C · Tres reglas** (brand kit v1, agosto 2026): tres
reglas horizontales de anchura 100 % / 66 % / 33 %, la tercera en acento,
apiladas y alineadas a la izquierda.

## Dónde vive la marca

**En el código, no en ficheros de imagen.** El isotipo y los dos lockups son
SVG en línea: `src/server/views/components/brand.tsx`. Al estar hechos de
rectángulos que heredan `currentColor`, la misma marca sirve sobre fondo, sobre
tinta y sobre acento sin duplicar ficheros ni versiones por tema.

Proporciones fijas, que no se retocan a ojo:

- anchuras 100 % / 66 % / 33 %, **en ese orden**;
- grosor = 1/5 del alto del bloque;
- hueco entre reglas = 0,6 × grosor;
- área de respeto = 1 × el alto del isotipo.

Usos incorrectos: puntas redondeadas, centrada, toda en rojo, orden invertido.

## Lo que sí son ficheros

Sólo lo que un navegador no puede resolver con SVG en línea. Se generan con:

```bash
python3 scripts/build-brand.py
```

| Fichero | Uso |
|---|---|
| `/favicon.ico` | Pestaña del navegador (16, 32 y 48 px) |
| `/apple-touch-icon.png` | Pantalla de inicio en iOS (180 px) |
| `/icon-192.png`, `/icon-512.png` | Manifiesto PWA |
| `assets/brand/og-default.jpg` | Tarjeta por omisión para redes (1200×630) |

Todos llevan el isotipo **en caja de tinta**, nunca sobre fondo claro: a 16 px
las reglas necesitan el contraste máximo. Es una regla explícita del brand kit.

## Historial

Antes de la marca 1C el sitio usaba un logotipo de triángulo generado desde
`triangulo_brand.zip`. Se retiró al aprobarse esta identidad; el script de
generación de aquellos ficheros ya no existe.
