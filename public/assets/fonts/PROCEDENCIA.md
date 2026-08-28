# Tipografía

**Archivo**, la familia del sistema visual «Modernist» definido en el handoff de
diseño. Un único fichero variable de 400 a 800 cubre los tres pesos que usa el
sitio: cuerpo (400), metadatos (600) y titulares (800).

| Fichero | Familia | Peso |
|---|---|---|
| `archivo-latin.woff2` | Archivo (variable) | 400–800 |

Se sirve **desde este dominio**, no desde Google Fonts. Enlazar a
`fonts.googleapis.com` enviaría la IP de cada visitante a un tercero —un
problema real de RGPD en la UE— y añadiría una dependencia externa que el
proyecto no necesita.

Subconjunto **latino**: cubre el español completo (acentos, `ñ`, `¿`, `¡`,
comillas y guiones tipográficos). 35 kB.

Licencia **SIL Open Font License 1.1** — https://github.com/Omnibus-Type/Archivo

Para actualizarla: descargar el `.woff2` del subconjunto latino desde la hoja
que sirve Google Fonts con un `User-Agent` moderno y sustituir el fichero
conservando el nombre, para que la cache inmutable de `_headers` siga siendo
válida sólo cuando el contenido cambia de verdad.
