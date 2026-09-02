#!/usr/bin/env python3
"""
Importa el catálogo exportado por MyLibrary a la biblioteca.

MyLibrary es la aplicación de Android desde la que salió el catálogo. Su
exportación es un zip con:

    mylibrary.db                 base SQLite con las tablas BOOK y AUTHOR
    MiBibliotecaImageness.txt    las portadas, en base64
    MiBiblioteca*.xlsx           el mismo catálogo en hoja de cálculo (se ignora)

Por qué Python y no Node: leer un fichero SQLite necesita `node:sqlite`, que no
existe hasta Node 22, y el proyecto va con el 20. En Python está en la
biblioteca estándar, igual que la lectura del zip. Sin dependencias nuevas.

Qué hace y qué no:

  - **No traduce las fichas.** Eso lo hace el servidor
    (`src/server/lib/mylibrary.ts`), donde la conversión se puede probar. Aquí
    sólo se extrae y se envía.
  - **Es reanudable.** Guarda por dónde va en un fichero de estado, así que si
    se corta a mitad se vuelve a lanzar y sigue donde estaba.
  - **No pisa nada.** Un ISBN que ya está en el catálogo se salta.

    python3 scripts/import-mylibrary.py mylibrary.zip \\
        --url https://books.triangulodelectores.site

    python3 scripts/import-mylibrary.py mylibrary.zip --url … --apply

Sin `--apply` no escribe nada: analiza el zip, dice cuántos libros y cuántas
portadas hay y avisa de lo que no cuadre.
"""

import argparse
import base64
import getpass
import json
import os
import re
import sqlite3
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from http.cookiejar import CookieJar
from pathlib import Path

NOMBRE_DB = "mylibrary.db"
# El nombre del fichero de imágenes varía según el idioma de la aplicación, así
# que se busca por contenido y no por nombre exacto.
PATRON_IMAGENES = re.compile(r"image", re.I)


# --------------------------------------------------------------- lectura --
def leer_zip(ruta):
    """Saca de la exportación lo único que hace falta: la base y las imágenes."""
    with zipfile.ZipFile(ruta) as z:
        nombres = z.namelist()

        db = next((n for n in nombres if n.endswith(".db")), None)
        if not db:
            raise SystemExit("El zip no contiene ninguna base .db")

        imagenes = next(
            (n for n in nombres if n.endswith(".txt") and PATRON_IMAGENES.search(n)), None
        )

        temporal = Path(tempfile.mkdtemp(prefix="mylibrary-"))
        destino_db = temporal / "mylibrary.db"
        destino_db.write_bytes(z.read(db))

        crudo = z.read(imagenes).decode("utf-8", "replace") if imagenes else ""
        return destino_db, crudo


def parsear_imagenes(crudo):
    """
    Las portadas, en el orden en que las escribió la exportación.

    El formato no está documentado y la muestra sólo trae una: puede ser un
    objeto suelto, una lista o un objeto por línea. Se prueban las tres en vez
    de dar por hecha una.
    """
    crudo = crudo.strip()
    if not crudo:
        return []

    try:
        dato = json.loads(crudo)
        if isinstance(dato, list):
            return dato
        if isinstance(dato, dict):
            return [dato]
    except json.JSONDecodeError:
        pass

    imagenes = []
    for linea in crudo.splitlines():
        linea = linea.strip()
        if not linea:
            continue
        try:
            imagenes.append(json.loads(linea))
        except json.JSONDecodeError:
            continue
    return imagenes


def leer_libros(ruta_db):
    """Fichas de la tabla BOOK, con el autor ya resuelto y en orden de ID."""
    conexion = sqlite3.connect(ruta_db)
    conexion.row_factory = sqlite3.Row

    autores = {}
    for fila in conexion.execute("SELECT ID, FIRSTNAME, LASTNAME FROM AUTHOR"):
        nombre = " ".join(p for p in [fila["FIRSTNAME"], fila["LASTNAME"]] if p)
        autores[fila["ID"]] = {
            "compuesto": nombre.strip() or None,
            # El apellido va aparte porque es el criterio con el que está
            # ordenada la biblioteca en papel, y ordenar por el nombre compuesto
            # ordena en realidad por el nombre de pila.
            "apellido": (fila["LASTNAME"] or "").strip(),
            "nombre": (fila["FIRSTNAME"] or "").strip(),
        }

    libros = []
    for fila in conexion.execute("SELECT * FROM BOOK ORDER BY ID"):
        libro = dict(fila)
        libros.append(
            {
                "sourceId": libro["ID"],
                "title": libro.get("TITLE") or "",
                "author": (autores.get(libro.get("AUTHOR")) or {}).get("compuesto"),
                "additionalAuthors": lista_json(libro.get("ADDITIONAL_AUTHORS")),
                "isbn": libro.get("ISBN"),
                "pages": libro.get("PAGES"),
                "publishedDate": libro.get("PUBLISHED_DATE"),
                "publisher": libro.get("PUBLISHER"),
                "summary": libro.get("SUMMARY"),
                "series": libro.get("SERIES"),
                "categories": lista_json(libro.get("CATEGORIES")),
                "comments": lista_json(libro.get("COMMENTS")),
                "readingDates": libro.get("READING_DATES"),
                "read": bool(libro.get("READ")),
                "inWishlist": bool(libro.get("IN_WISHLIST")),
                "amazonUrl": libro.get("AMAZON_URL"),
                "fnacUrl": libro.get("FNAC_URL"),
                "_coverPath": libro.get("COVER_PATH"),
                "_apellido": (autores.get(libro.get("AUTHOR")) or {}).get("apellido", ""),
                "_nombre": (autores.get(libro.get("AUTHOR")) or {}).get("nombre", ""),
            }
        )
    conexion.close()
    return libros


def lista_json(valor):
    """Varios campos vienen como un array JSON dentro de una columna de texto."""
    if not valor:
        return []
    try:
        dato = json.loads(valor)
    except (json.JSONDecodeError, TypeError):
        return [str(valor)]
    if isinstance(dato, list):
        return [str(x) for x in dato if str(x).strip()]
    return [str(dato)] if str(dato).strip() else []


# ------------------------------------------------------------ portadas --
def clave_texto(valor):
    """
    Clave de ordenación alfabética a la española.

    Ordenar por el valor en crudo compara códigos de carácter, y ahí «Álvarez»
    va detrás de «Zapata». Quitando los acentos para comparar se obtiene el
    mismo orden que usaría cualquier aplicación con una configuración regional,
    que es lo que hay que reproducir.
    """
    import unicodedata

    sin_tildes = unicodedata.normalize("NFKD", (valor or "").strip())
    return "".join(c for c in sin_tildes if not unicodedata.combining(c)).lower()


def clave_fichero(libro):
    """
    Nombre del fichero de portada tal cual, para poder ordenar como lo haría un
    listado de directorio: «1.png», «10.png», «100.png», «2.png»…
    """
    ruta = (libro.get("_coverPath") or "").strip()
    return ruta.rsplit("/", 1)[-1] if ruta else ""


# Órdenes posibles en que la exportación pudo escribir las imágenes.
#
# El `elementHashcode` del fichero no sirve para emparejar —es el `hashCode()`
# de identidad de la JVM, y está comprobado que no se puede recalcular desde
# ninguna combinación de campos—, así que lo único que queda es el orden. Cuál
# es depende de cómo recorriera la aplicación su catálogo, y eso no está
# documentado: por eso se prueban varios y se comprueba con los ojos.
ORDENES = {
    "id": ("por ID de la ficha", lambda libro: libro["sourceId"]),
    "fichero": ("por nombre del fichero de imagen, alfabético", clave_fichero),
    "titulo": ("por título, alfabético", lambda libro: clave_texto(libro["title"])),
    "apellido": (
        "por apellido del autor y, a igual autor, por título",
        lambda libro: (clave_texto(libro["_apellido"]), clave_texto(libro["_nombre"]), clave_texto(libro["title"])),
    ),
    "apellido-id": (
        "por apellido del autor y, a igual autor, por orden de alta",
        lambda libro: (clave_texto(libro["_apellido"]), clave_texto(libro["_nombre"]), libro["sourceId"]),
    ),
    "nombre": (
        "por nombre completo del autor, alfabético",
        lambda libro: (clave_texto(libro["author"]), clave_texto(libro["title"])),
    ),
    "id-desc": ("por ID descendente, lo más nuevo primero", lambda libro: -libro["sourceId"]),
}


def emparejar_portadas(libros, imagenes, orden="id"):
    """
    Asocia cada portada con su libro.

    **Esto es lo delicado de la importación.** El fichero de imágenes trae un
    `elementHashcode`, pero es el `hashCode()` de identidad de la JVM que hizo
    la exportación: un número que no se puede recalcular desde fuera y que no
    corresponde a ningún campo de la ficha. Comprobado sobre la muestra.

    Lo único que queda es el orden, y **cuál es no está documentado**: contra la
    exportación real, el orden por ID resultó no ser el bueno aunque las
    cantidades cuadrasen. Por eso hay varios candidatos (`ORDENES`) y un modo de
    diagnóstico que los vuelca a disco para compararlos a ojo.

    Que las cantidades coincidan es condición necesaria y no suficiente: si no
    coinciden **no se adivina**, y aunque coincidan hay que haber comprobado el
    orden antes. Una portada en el libro equivocado es peor que ninguna.
    """
    _, clave = ORDENES[orden]
    con_portada = sorted(
        (libro for libro in libros if (libro.get("_coverPath") or "").strip()),
        key=clave,
    )
    de_libros = [img for img in imagenes if (img.get("type") or "BOOK").upper() == "BOOK"]

    if len(con_portada) != len(de_libros):
        return None, (
            f"{len(con_portada)} libros con portada en la base y {len(de_libros)} imágenes "
            "de tipo BOOK en el fichero: no se pueden emparejar con seguridad"
        )

    return {
        libro["sourceId"]: (img.get("base64Image"), img.get("imageOrientation", 0))
        for libro, img in zip(con_portada, de_libros)
    }, None


def decodificar(base64_texto):
    """La exportación parte el base64 en líneas: hay que quitarlas antes."""
    if not base64_texto:
        return None
    limpio = re.sub(r"\s+", "", base64_texto)
    try:
        return base64.b64decode(limpio, validate=True)
    except (base64.binascii.Error, ValueError):
        return None


# Lado mayor al que se reduce cada portada. Son fotos de móvil de 2.000 px y en
# el catálogo se ven a 72×108: subir el original serían decenas de megas en R2
# para nada. 1200 deja margen de sobra para verlas en grande en un móvil.
LADO_MAXIMO = 1200


def preparar_imagen(datos, orientacion):
    """
    Endereza y aligera la portada antes de subirla.

    Las portadas de esta exportación no son escaneos: son **fotos del libro
    hechas con el móvil**. Eso trae dos cosas que hay que atender.

    `imageOrientation` dice cuánto hay que girar la foto. Viene en grados
    (0/90/180/270 — no es un código EXIF, que empieza en 1 y aquí aparece el 0).
    Si se ignora, los libros fotografiados en vertical acaban tumbados.

    Y el tamaño: 228 fotos de 2.000 px son cerca de 180 MB en R2 para enseñarlas
    a 72 px de ancho. Se reducen y se recodifican.

    Si Pillow no está instalado se sube el original tal cual: perder la
    importación entera por no poder redimensionar sería absurdo.
    """
    try:
        from PIL import Image
    except ImportError:
        return datos

    import io as _io

    try:
        with Image.open(_io.BytesIO(datos)) as imagen:
            imagen = imagen.convert("RGB")

            grados = {90: 90, 180: 180, 270: 270}.get(int(orientacion or 0))
            if grados:
                # `expand` para que al girar 90° no se recorte a la caja vieja.
                imagen = imagen.rotate(-grados, expand=True)

            if max(imagen.size) > LADO_MAXIMO:
                imagen.thumbnail((LADO_MAXIMO, LADO_MAXIMO), Image.LANCZOS)

            salida = _io.BytesIO()
            imagen.save(salida, format="JPEG", quality=82, optimize=True)
            return salida.getvalue()
    except Exception:
        # Una foto corrupta no puede tumbar la importación: se sube el original
        # y que decida el validador del servidor.
        return datos


def escribir_muestras(libros, portadas, cuantas, carpeta, orden="id"):
    """
    Vuelca a disco unas cuantas portadas con el título del libro por nombre.

    Es la única forma de comprobar el emparejamiento: el fichero de imágenes no
    trae nada que permita verificarlo por programa. Se toman del principio y del
    final, porque un desalineamiento a mitad de catálogo lo delatan las últimas
    y no las primeras.
    """
    carpeta.mkdir(parents=True, exist_ok=True)
    for viejo in carpeta.glob("*.jpg"):
        viejo.unlink()

    _, clave = ORDENES[orden]
    con_portada = sorted((l for l in libros if l["sourceId"] in portadas), key=clave)
    mitad = max(1, cuantas // 2)
    elegidos = con_portada[:mitad] + con_portada[-mitad:]

    for libro in elegidos:
        base64_texto, orientacion = portadas.get(libro["sourceId"], (None, 0))
        datos = decodificar(base64_texto)
        if not datos:
            continue
        # Se escriben ya preparadas: la muestra debe enseñar lo que se subirá.
        datos = preparar_imagen(datos, orientacion)
        indice = con_portada.index(libro) + 1
        titulo = re.sub(r"[^\w\s-]", "", libro["title"])[:60].strip() or "sin-titulo"
        (carpeta / f"{indice:03d}-{titulo}.jpg").write_bytes(datos)
    return carpeta


def escribir_diagnostico(libros, imagenes, cuantas):
    """
    Vuelca muestras de **cada** orden posible, una carpeta por hipótesis.

    Existe porque la primera suposición —orden por ID— falló contra la
    exportación real aunque las cantidades cuadrasen: 228 imágenes para 228
    libros con portada, y aun así los títulos no correspondían. Sin una forma de
    comparar hipótesis, la alternativa era ir probando a ciegas sobre el
    catálogo de verdad.
    """
    raiz = Path("import-diagnostico")
    for clave in ORDENES:
        portadas, aviso = emparejar_portadas(libros, imagenes, clave)
        if aviso:
            continue
        escribir_muestras(libros, portadas, cuantas, raiz / f"orden-{clave}", clave)
    return raiz


# ---------------------------------------------------------------- envío --
def fijar_ip(host, ip):
    """
    Resuelve `host` a `ip` sin preguntar al resolutor del sistema.

    Hace falta porque un router doméstico cachea las respuestas negativas: si se
    consultó el nombre **antes** de que existiera, sigue contestando «no existe»
    durante un buen rato aunque el dominio ya esté publicado. Y no hay forma de
    decirle a `urllib` que use otro servidor DNS.

    El nombre se sigue usando para el SNI y para la cabecera `Host`, así que el
    certificado y el enrutado de Cloudflare siguen siendo los correctos: lo
    único que se sustituye es el paso de nombre a dirección.
    """
    import socket

    original = socket.getaddrinfo

    def resolver(nombre, puerto, *args, **kwargs):
        if nombre == host:
            return original(ip, puerto, *args, **kwargs)
        return original(nombre, puerto, *args, **kwargs)

    socket.getaddrinfo = resolver


def explicar_dns(host, error):
    """El nombre no resuelve. Casi siempre es caché negativa, no una caída."""
    print(f"\nNo se puede resolver «{host}»: {error}\n", file=sys.stderr)
    print("El dominio existe pero tu resolutor no lo ve. Lo habitual es que sea", file=sys.stderr)
    print("caché negativa: si se consultó el nombre antes de que se publicara, el", file=sys.stderr)
    print("router o el resolutor recuerdan que «no existe» durante un rato.\n", file=sys.stderr)
    print("Compruébalo:", file=sys.stderr)
    print(f"    dig +short {host}          # tu resolutor", file=sys.stderr)
    print(f"    dig @1.1.1.1 +short {host} # uno público", file=sys.stderr)
    print("\nSi el segundo responde y el primero no, es eso. Opciones:\n", file=sys.stderr)
    print("  1. Saltarse el DNS para esta ejecución, con la IP que dé el público:", file=sys.stderr)
    print(f"       python3 {sys.argv[0]} … --ip 188.114.96.5", file=sys.stderr)
    print("  2. Reiniciar el router, que es quien suele cachear.", file=sys.stderr)
    print("  3. Esperar a que caduque la caché negativa (hasta una hora).\n", file=sys.stderr)
    raise SystemExit(1)


# Identificación del script. Se manda de verdad —no se disfraza de navegador—
# porque en los registros del sitio conviene distinguir una importación de una
# visita. Si el borde de Cloudflare lo bloquea, la salida lo explica y se puede
# cambiar con --agente.
AGENTE = "TrianguloDeLectores-Import/1.0 (+https://triangulodelectores.site)"


class Cliente:
    """Cliente HTTP mínimo con sesión. Sin dependencias."""

    def __init__(self, base, agente=AGENTE):
        self.base = base.rstrip("/")
        self.agente = agente
        self.jar = CookieJar()
        self.abridor = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.csrf = None

    def entrar(self, email, password):
        datos = urllib.parse.urlencode({"email": email, "password": password}).encode()
        peticion = urllib.request.Request(
            f"{self.base}/login",
            data=datos,
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": self.base,
                "Sec-Fetch-Site": "same-origin",
                "User-Agent": self.agente,
                "Accept": "text/html,application/xhtml+xml",
                "Accept-Language": "es-ES,es;q=0.9",
            },
        )
        try:
            with self.abridor.open(peticion):
                pass
        except urllib.error.HTTPError as error:
            explicar_rechazo(error)
        except urllib.error.URLError as error:
            # `URLError` envuelve el fallo de resolución, que es lo que más
            # veces va a pasar justo después de publicar un subdominio.
            explicar_dns(urllib.parse.urlparse(self.base).hostname, error.reason)

        # El token CSRF se lee de un formulario ya autenticado. Si no aparece,
        # es que el login no ha cuajado: la respuesta de error también es un 200
        # con la página de acceso, así que el token es la señal fiable.
        with self.abridor.open(
            urllib.request.Request(
                f"{self.base}/", headers={"Accept": "text/html", "User-Agent": self.agente}
            )
        ) as respuesta:
            html = respuesta.read().decode("utf-8", "replace")

        match = re.search(r'name="_csrf" value="([^"]+)"', html)
        if not match:
            raise SystemExit("No se ha podido iniciar sesión: revisa el correo y la contraseña")
        self.csrf = match.group(1)

    def _cabeceras(self, extra=None):
        cabeceras = {
            "Origin": self.base,
            "Sec-Fetch-Site": "same-origin",
            "Accept": "application/json",
            "User-Agent": self.agente,
            "X-CSRF-Token": self.csrf or "",
        }
        cabeceras.update(extra or {})
        return cabeceras

    def json(self, metodo, ruta, cuerpo):
        peticion = urllib.request.Request(
            f"{self.base}{ruta}",
            data=json.dumps(cuerpo).encode("utf-8"),
            method=metodo,
            headers=self._cabeceras({"Content-Type": "application/json"}),
        )
        return self._enviar(peticion)

    def crudo(self, metodo, ruta, datos, tipo):
        peticion = urllib.request.Request(
            f"{self.base}{ruta}", data=datos, method=metodo,
            headers=self._cabeceras({"Content-Type": tipo}),
        )
        return self._enviar(peticion)

    def _enviar(self, peticion):
        try:
            with self.abridor.open(peticion) as respuesta:
                return respuesta.status, json.loads(respuesta.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            cuerpo = error.read().decode("utf-8", "replace")
            try:
                return error.code, json.loads(cuerpo)
            except json.JSONDecodeError:
                # Un cuerpo que no es JSON en mitad de la importación suele ser
                # el borde bloqueando, no la aplicación respondiendo.
                return error.code, {"error": {"message": cuerpo[:200].replace("\n", " ")}}


def explicar_rechazo(error):
    """
    Traduce un rechazo HTTP a algo accionable, en vez de a una traza.

    Distinguir quién dice que no es lo importante: **el borde de Cloudflare y la
    aplicación devuelven códigos parecidos por motivos opuestos**. Un 403 de la
    aplicación significa que falta el token o el origen no cuadra; un 403 del
    borde significa que la petición ni siquiera ha llegado al Worker, y ahí no
    hay nada que arreglar en el código.

    La señal fiable es `X-Request-Id`: la pone el middleware de contexto en toda
    respuesta del Worker. `cf-ray` **no** sirve para distinguir —lo lleva todo lo
    que pasa por Cloudflare, incluidas nuestras propias respuestas—, y mirar si
    el cuerpo es JSON tampoco: las páginas de error de la aplicación son HTML.
    """
    cuerpo = error.read().decode("utf-8", "replace")
    cf_ray = error.headers.get("cf-ray")
    es_nuestro = bool(error.headers.get("x-request-id"))

    print(f"\nLa petición ha sido rechazada con un {error.code}.\n", file=sys.stderr)

    if es_nuestro and error.code == 401:
        print("La aplicación dice que las credenciales no son correctas.", file=sys.stderr)
        print("Revisa el correo y la contraseña de acceso a la biblioteca.\n", file=sys.stderr)
        raise SystemExit(1)

    if es_nuestro and error.code == 429:
        # El límite de acceso son 5 intentos por IP cada 15 minutos. Se llega
        # aquí probando contraseñas, y también si el script se relanza en bucle.
        espera = error.headers.get("retry-after")
        print("Demasiados intentos de acceso seguidos: el límite de la propia", file=sys.stderr)
        print("aplicación son 5 por IP cada 15 minutos.", file=sys.stderr)
        print(f"Espera {espera + ' segundos' if espera else 'un cuarto de hora'} y vuelve a lanzarlo.", file=sys.stderr)
        print("El progreso está guardado: continuará donde se quedó.\n", file=sys.stderr)
        raise SystemExit(1)

    if not es_nuestro:
        print("Lo bloquea el borde de Cloudflare, no la aplicación: la petición no", file=sys.stderr)
        print("llega siquiera al Worker. Suele ser una de estas dos:\n", file=sys.stderr)
        print("  · Bot Fight Mode (Security > Bots). Bloquea a cualquier cliente que", file=sys.stderr)
        print("    no sea un navegador, y este script no lo es.", file=sys.stderr)
        print("  · Una regla del WAF.\n", file=sys.stderr)
        print("Opciones, de más limpia a menos:\n", file=sys.stderr)
        print("  1. Crear una regla de WAF que salte la comprobación para tu IP", file=sys.stderr)
        print("     mientras dure la importación (Security > WAF > Custom rules,", file=sys.stderr)
        print("     acción «Skip»). Es lo más acotado.", file=sys.stderr)
        print("  2. Desactivar Bot Fight Mode un rato y volver a activarlo.", file=sys.stderr)
        print("  3. Importar contra el entorno local con `npm run local`.\n", file=sys.stderr)
        if cf_ray:
            print(f"Ray ID del bloqueo, por si quieres buscarlo en los eventos: {cf_ray}", file=sys.stderr)
    else:
        print("Lo rechaza la aplicación, no el borde. Respuesta:\n", file=sys.stderr)
        print(f"  {cuerpo[:400]}\n", file=sys.stderr)

    raise SystemExit(1)


# ----------------------------------------------------------------- flujo --
def main():
    parser = argparse.ArgumentParser(description="Importa el catálogo de MyLibrary")
    parser.add_argument("zip", help="exportación de MyLibrary (.zip)")
    parser.add_argument("--url", required=True, help="origen del subdominio, p. ej. https://books.triangulodelectores.site")
    parser.add_argument("--apply", action="store_true", help="escribe de verdad (sin esto sólo analiza)")
    parser.add_argument(
        "--portadas", choices=sorted(ORDENES),
        help=(
            "importa también las portadas, emparejándolas con ese orden. "
            "Sin esta opción no se sube ninguna: el orden bueno no está documentado "
            "y hay que comprobarlo antes con --diagnostico"
        ),
    )
    parser.add_argument(
        "--ip",
        help="fija la IP del servidor y salta el DNS del sistema (útil si el router cachea)",
    )
    parser.add_argument(
        "--agente", default=AGENTE,
        help="cabecera User-Agent con la que identificarse (por si el borde bloquea la de por omisión)",
    )
    parser.add_argument(
        "--diagnostico", action="store_true",
        help="vuelca muestras de cada orden posible para ver a ojo cuál es el bueno",
    )
    parser.add_argument("--estado", default=".import-mylibrary.json", help="fichero de progreso, para reanudar")
    parser.add_argument(
        "--muestras", type=int, default=6,
        help="cuántas portadas volcar a disco en el análisis, para comprobar el emparejamiento",
    )
    args = parser.parse_args()

    ruta_db, crudo_imagenes = leer_zip(args.zip)
    libros = leer_libros(ruta_db)
    imagenes = parsear_imagenes(crudo_imagenes)
    portadas, aviso = emparejar_portadas(libros, imagenes, args.portadas or "id")

    print(f"\nExportación: {args.zip}")
    print(f"  libros en la base .......... {len(libros)}")
    print(f"  imágenes en el fichero ..... {len(imagenes)}")
    if not args.portadas:
        portadas = {}

    if aviso and args.portadas:
        print(f"\n  AVISO: {aviso}.")
        print("  Se importarán las fichas SIN portada. Una portada en el libro")
        print("  equivocado es peor que ninguna portada.\n")
        portadas = {}
    elif args.portadas:
        etiqueta = ORDENES[args.portadas][0]
        print(f"  portadas emparejadas ....... {len(portadas)} ({etiqueta})")
    else:
        print("  portadas ................... ninguna (usa --portadas <orden>)")

    sin_cover_path = [l for l in libros if not (l.get("_coverPath") or "").strip()]
    if sin_cover_path and len(sin_cover_path) <= 5:
        for libro in sin_cover_path:
            print(f"  sin portada en el origen ... «{libro['title']}»")

    sin_titulo = [l for l in libros if not (l["title"] or "").strip()]
    if sin_titulo:
        print(f"  sin título (se omiten) ..... {len(sin_titulo)}")

    if args.diagnostico:
        raiz = escribir_diagnostico(libros, imagenes, args.muestras)
        print(f"\n  Muestras de cada orden en {raiz}/\n")
        print("  Hay una carpeta por hipótesis. En cada una, el NOMBRE del fichero es el")
        print("  título del libro y el CONTENIDO es la portada que le tocaría con ese orden.")
        print("  Abre las carpetas y busca aquella en la que las portadas corresponden a")
        print("  los títulos. Luego importa con esa:\n")
        for clave, (etiqueta, _) in ORDENES.items():
            print(f"    --portadas {clave:<12} {etiqueta}")
        print()
        return

    if not args.apply:
        if portadas and args.muestras > 0:
            carpeta = escribir_muestras(libros, portadas, args.muestras, Path("import-muestras"))
            print(f"\n  Muestras escritas en {carpeta}/")
            print("  Comprueba que cada portada corresponde al título del fichero antes de")
            print("  importar: el orden bueno no está documentado.")
        elif not args.portadas:
            print("\n  Para las portadas, primero averigua el orden bueno:")
            print(f"    python3 {sys.argv[0]} {args.zip} --url {args.url} --diagnostico")
        print("\nEsto ha sido un análisis. Añade --apply para importar de verdad.\n")
        return

    estado_ruta = Path(args.estado)
    estado = json.loads(estado_ruta.read_text()) if estado_ruta.exists() else {}

    email = os.environ.get("BOOKS_EMAIL") or input("Correo de acceso: ").strip()
    password = os.environ.get("BOOKS_PASSWORD") or getpass.getpass("Contraseña: ")

    if args.ip:
        fijar_ip(urllib.parse.urlparse(args.url).hostname, args.ip)
        print(f"Resolviendo {urllib.parse.urlparse(args.url).hostname} a {args.ip} (--ip)")

    cliente = Cliente(args.url, args.agente)
    cliente.entrar(email, password)
    print(f"\nSesión iniciada en {args.url}\n")

    creados = saltados = fallidos = con_portada = 0
    for libro in libros:
        clave = str(libro["sourceId"])
        if clave in estado:
            saltados += 1
            continue
        if not (libro["title"] or "").strip():
            continue

        ficha = {k: v for k, v in libro.items() if not k.startswith("_")}
        codigo, respuesta = cliente.json("POST", "/api/biblioteca/importar", ficha)

        if codigo == 409:
            # Ya estaba: la importación se puede repetir sin duplicar.
            estado[clave] = "duplicado"
            saltados += 1
        elif codigo == 201:
            libro_id = respuesta["data"]["id"]
            estado[clave] = libro_id
            creados += 1

            base64_texto, orientacion = portadas.get(libro["sourceId"], (None, 0))
            datos = preparar_imagen(decodificar(base64_texto), orientacion) if base64_texto else None
            if datos:
                codigo_portada, _ = cliente.crudo(
                    "PUT", f"/api/biblioteca/{libro_id}/portada", datos, "image/jpeg"
                )
                if codigo_portada == 200:
                    con_portada += 1
        else:
            fallidos += 1
            mensaje = respuesta.get("error", {}).get("message", "?")
            print(f"  fallo en «{libro['title'][:40]}»: {codigo} {mensaje}")

        estado_ruta.write_text(json.dumps(estado, ensure_ascii=False))
        hechos = creados + saltados + fallidos
        if hechos % 25 == 0:
            print(f"  {hechos}/{len(libros)}…")

    print(f"\nImportación terminada:")
    print(f"  creados .................... {creados}")
    print(f"  con portada ................ {con_portada}")
    print(f"  ya estaban / saltados ...... {saltados}")
    print(f"  fallidos ................... {fallidos}")
    print(f"\nProgreso guardado en {estado_ruta}. Volver a lanzarlo continúa donde se quedó.\n")


if __name__ == "__main__":
    main()
