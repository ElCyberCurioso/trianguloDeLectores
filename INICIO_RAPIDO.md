# 🚀 Inicio Rápido - Triángulo de Lectores

## Paso 1: Subir a GitHub

```bash
# Inicializa el repositorio
git init

# Agrega todos los archivos
git add .

# Haz tu primer commit
git commit -m "Initial commit: Setup Triángulo de Lectores"

# Conecta con tu repositorio en GitHub (crea uno primero en github.com)
git remote add origin https://github.com/TU_USUARIO/trianguloDeLectores.git

# Sube los archivos
git push -u origin main
```

## Paso 2: Activar GitHub Pages

1. Ve a tu repositorio en GitHub
2. Click en **Settings** → **Pages**
3. En **Source**, selecciona `main` branch y carpeta `/ (root)`
4. Click en **Save**
5. ¡Espera 1-2 minutos y tu sitio estará en línea!

## Paso 3: Agregar tu primera review

1. Abre el archivo `reviews.json`
2. Copia este ejemplo y modifícalo:

```json
{
  "titulo": "Tu libro/serie/película favorita",
  "autor": "Nombre del autor/director",
  "tipo": "libro",
  "calificacion": 5,
  "descripcion": "¿Qué te pareció? Escribe aquí tu opinión...",
  "fecha": "2026-01-14",
  "imagen": ""
}
```

3. Guarda el archivo
4. Sube los cambios:

```bash
git add reviews.json
git commit -m "Agrega nueva review"
git push
```

## ✅ ¡Listo!

Tu review aparecerá en el sitio en 1-2 minutos.

## 📱 Ver tu sitio

Tu sitio estará disponible en:
```
https://TU_USUARIO.github.io/trianguloDeLectores
```

## 🖼️ Agregar Imágenes

### Opción 1: Imagen Local (Recomendado)

1. Guarda tu imagen en la carpeta correcta:
   - `images/libros/` para libros
   - `images/series/` para series
   - `images/peliculas/` para películas
   - `images/otros/` para otros

2. Nómbrala sin espacios: `mi-libro.jpg`

3. En tu review:
```json
"imagen": "images/libros/mi-libro.jpg"
```

### Opción 2: URL Externa

```json
"imagen": "https://ejemplo.com/portada.jpg"
```

### Opción 3: Sin Imagen

```json
"imagen": ""
```

## 📅 Control de Publicación

### Publicar Inmediatamente
```json
"estado": "publicado",
"fecha_publicacion": "2026-01-14"
```

### Guardar como Borrador
```json
"estado": "borrador",
"fecha_publicacion": ""
```
No aparecerá en el sitio hasta que lo publiques.

### Programar para el Futuro
```json
"estado": "programado",
"fecha_publicacion": "2026-02-15"
```
Se publicará automáticamente en esa fecha.

## 💡 Consejos

- **Calificación**: Usa números del 1 al 5 (puedes usar decimales: 4.5, 3.5, etc.)
- **Tipo**: Debe ser exactamente: `"libro"`, `"serie"`, `"pelicula"` o `"otro"`
- **Fecha**: Usa formato YYYY-MM-DD (ejemplo: 2026-01-14)
- **Imagen**: Local (`images/tipo/nombre.jpg`), URL externa, o vacía (`""`)
- **Autor**: Opcional - puedes dejarlo vacío si no aplica
- **Dimensiones imagen**: 400x600px es ideal (proporción 2:3)
- **Estado**: Omite estos campos o usa `"estado": "publicado"` para publicar inmediatamente

## 🎨 Probar localmente

Antes de hacer push, puedes ver cómo se ve:

```bash
# Con Python
python -m http.server 8000

# O simplemente abre index.html en tu navegador
```

## ❓ Problemas comunes

**"No se ven las reviews"**
- Verifica que `reviews.json` tenga el formato correcto
- Usa un validador JSON online para verificar

**"Los cambios no aparecen"**
- GitHub Pages tarda 1-2 minutos en actualizar
- Limpia el caché del navegador (Ctrl+F5)

**"Error al cargar"**
- Asegúrate de que todos los archivos estén en la rama `main`
- Verifica que GitHub Pages esté activado en Settings

---

¿Necesitas ayuda? Revisa el `README.md` completo para más detalles.
