# 📚 Triángulo de Lectores

Una página web moderna y responsive para publicar reviews de libros, series, películas y más. Desplegada con GitHub Pages.

## ✨ Características

- 🎨 **Diseño moderno y responsive** - Se adapta perfectamente a móviles, tablets y escritorio
- 🌓 **Modo oscuro** - Cambia entre tema claro y oscuro con un clic
- 🔍 **Búsqueda en tiempo real** - Encuentra reviews rápidamente
- 🏷️ **Filtros por categoría** - Libros, Series, Películas, Otros
- ⭐ **Sistema de calificación** - Estrellas visuales de 1 a 5
- 🚀 **Sin dependencias** - HTML, CSS y JavaScript puro
- 📱 **PWA Ready** - Puede convertirse fácilmente en una Progressive Web App

## 🚀 Inicio Rápido

### 1. Configurar GitHub Pages

1. Ve a tu repositorio en GitHub
2. Haz clic en **Settings** (Configuración)
3. En el menú lateral, selecciona **Pages**
4. En **Source** (Fuente), selecciona la rama `main` y la carpeta `/ (root)`
5. Haz clic en **Save** (Guardar)
6. Tu sitio estará disponible en: `https://[tu-usuario].github.io/trianguloDeLectores`

### 2. Añadir tu primera review

Edita el archivo `reviews.json` y agrega un nuevo objeto al array de reviews:

```json
{
  "titulo": "Título de tu review",
  "autor": "Autor o Director",
  "tipo": "libro",
  "calificacion": 4.5,
  "descripcion": "Tu opinión sobre la obra...",
  "fecha": "2026-01-14",
  "imagen": ""
}
```

#### Campos del JSON:

- **titulo** (obligatorio): El nombre del libro/serie/película
- **autor** (opcional): Autor, director o creador
- **tipo** (obligatorio): `"libro"`, `"serie"`, `"pelicula"`, `"anime"` o `"otro"`
- **calificacion** (obligatorio): Número del 1 al 5 (puede incluir decimales como 4.5)
- **descripcion** (obligatorio): Tu opinión y comentarios
- **fecha** (obligatorio): Fecha de la review en formato YYYY-MM-DD
- **imagen** (opcional): Ruta local (`images/libros/mi-libro.jpg`) o URL externa. Deja vacío `""` para usar imagen generada automáticamente
- **estado** (opcional): `"publicado"`, `"borrador"` o `"programado"`. Por defecto es `"publicado"`
- **fecha_publicacion** (opcional): Fecha en que se publicará (formato YYYY-MM-DD). Requerido si estado es `"programado"`

### 3. Agregar imágenes (Opcional)

Puedes usar imágenes locales o URLs externas:

#### **Opción A: Imágenes Locales** (Recomendado)

1. Guarda tu imagen en la carpeta correspondiente:
   - Libros → `images/libros/`
   - Series → `images/series/`
   - Películas → `images/peliculas/`
   - Anime → `images/anime/`
   - Otros → `images/otros/`

2. Nombra el archivo sin espacios: `mi-libro.jpg`, `breaking-bad.png`

3. En `reviews.json`, usa la ruta relativa:
```json
"imagen": "images/libros/cien-anos-soledad.jpg"
```

#### **Opción B: URLs Externas**

```json
"imagen": "https://ejemplo.com/portada.jpg"
```

#### **Opción C: Sin imagen**

```json
"imagen": ""
```
Se generará automáticamente una imagen con gradiente y emoji.

**💡 Tip:** Usa imágenes de 400x600px (proporción 2:3) y optimízalas antes de subirlas.

### 4. Control de Publicación (Opcional)

Puedes controlar cuándo se publican tus reviews usando los campos `estado` y `fecha_publicacion`:

#### **Opción A: Publicar Inmediatamente**

```json
{
  "titulo": "Mi Review",
  "estado": "publicado",
  "fecha_publicacion": "2026-01-14"
}
```

#### **Opción B: Guardar como Borrador**

```json
{
  "titulo": "Review en Proceso",
  "estado": "borrador",
  "fecha_publicacion": ""
}
```

La review NO aparecerá en el sitio hasta que cambies el estado a `"publicado"`.

#### **Opción C: Programar Publicación**

```json
{
  "titulo": "Review Futura",
  "estado": "programado",
  "fecha_publicacion": "2026-02-15"
}
```

La review aparecerá automáticamente el 15 de febrero de 2026.

#### **Archivo drafts.json (Opcional)**

También puedes usar `drafts.json` para organizar tus borradores antes de moverlos a `reviews.json`. Este archivo NO se carga en el sitio web.

### 5. Publicar cambios

```bash
git add .
git commit -m "Agrega nueva review"
git push origin main
```

Los cambios aparecerán en tu sitio en 1-2 minutos.

## 📝 Ejemplo de uso

### Agregar una review de libro:

```json
{
  "titulo": "El nombre del viento",
  "autor": "Patrick Rothfuss",
  "tipo": "libro",
  "calificacion": 5,
  "descripcion": "Una historia épica de fantasía que atrapa desde la primera página. La prosa es poética y los personajes están maravillosamente desarrollados.",
  "fecha": "2026-01-14",
  "imagen": ""
}
```

### Agregar una review de serie:

```json
{
  "titulo": "Stranger Things",
  "autor": "Los hermanos Duffer",
  "tipo": "serie",
  "calificacion": 4,
  "descripcion": "Nostalgia ochentera mezclada con terror sobrenatural. Las primeras temporadas son excepcionales, aunque pierde algo de fuerza después.",
  "fecha": "2026-01-14",
  "imagen": ""
}
```

## 🎨 Personalización

### Cambiar colores

Edita las variables CSS en `styles.css`:

```css
:root {
    --accent-primary: #6366f1;  /* Color principal */
    --accent-hover: #4f46e5;    /* Color hover */
}
```

### Cambiar tipografías

Modifica las fuentes de Google Fonts en `index.html` y actualiza las variables en `styles.css`:

```css
--font-main: 'Inter', sans-serif;
--font-display: 'Playfair Display', serif;
```

## 📁 Estructura de archivos

```
trianguloDeLectores/
├── index.html        # Página principal
├── styles.css        # Estilos y diseño
├── script.js         # Lógica y funcionalidad
├── reviews.json      # Base de datos de reviews
└── README.md         # Este archivo
```

## 🔧 Desarrollo Local

Para ver tu sitio localmente antes de hacer push:

1. **Opción 1**: Abre `index.html` directamente en tu navegador
2. **Opción 2**: Usa un servidor local (recomendado):

```bash
# Con Python 3
python -m http.server 8000

# Con Node.js (npx)
npx serve

# Con PHP
php -S localhost:8000
```

Luego visita `http://localhost:8000`

## 🐛 Solución de problemas

### Las reviews no aparecen

1. Verifica que `reviews.json` tenga el formato correcto (usa un validador JSON)
2. Asegúrate de que la fecha esté en formato YYYY-MM-DD
3. Revisa la consola del navegador (F12) para ver errores

### Los cambios no se reflejan en GitHub Pages

- GitHub Pages puede tardar 1-5 minutos en actualizar
- Limpia el caché del navegador (Ctrl+F5 o Cmd+Shift+R)
- Verifica que los archivos estén correctamente en la rama `main`

### Las imágenes no cargan

- Verifica que la URL de la imagen sea válida y accesible
- Usa URLs completas (https://...)
- Si dejas el campo `"imagen": ""` vacío, se generará una automáticamente

## 📄 Licencia

Este proyecto es de código abierto. Siéntete libre de usar, modificar y distribuir.

## 🤝 Contribuciones

¿Tienes ideas para mejorar el sitio? ¡Las contribuciones son bienvenidas!

---

**¡Felices reviews! 📖🎬📺**
