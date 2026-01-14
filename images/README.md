# 📁 Carpeta de Imágenes

Esta carpeta contiene las imágenes de las portadas de tus reviews.

## 📂 Estructura

```
images/
├── libros/       # Portadas de libros
├── series/       # Portadas de series
├── peliculas/    # Portadas de películas
└── otros/        # Otras imágenes
```

## 📝 Cómo usar

### 1. Guardar tu imagen

Guarda la imagen de la portada en la carpeta correspondiente:

- **Libros** → `images/libros/`
- **Series** → `images/series/`
- **Películas** → `images/peliculas/`
- **Otros** → `images/otros/`

### 2. Nombrar el archivo

Usa nombres descriptivos sin espacios ni caracteres especiales:

✅ **Correcto:**
- `cien-anos-de-soledad.jpg`
- `breaking-bad.png`
- `el-padrino.webp`

❌ **Incorrecto:**
- `Cien Años de Soledad.jpg` (espacios)
- `breaking_bad (2).png` (caracteres especiales)

### 3. Referenciar en reviews.json

En tu archivo `reviews.json`, usa la ruta relativa:

```json
{
  "titulo": "Cien años de soledad",
  "autor": "Gabriel García Márquez",
  "tipo": "libro",
  "imagen": "images/libros/cien-anos-de-soledad.jpg"
}
```

### 4. Subir a GitHub

```bash
git add images/
git add reviews.json
git commit -m "Agrega imágenes de reviews"
git push
```

## 🖼️ Formatos Recomendados

- **Formato:** JPG, PNG o WebP
- **Tamaño recomendado:** 400x600px (proporción 2:3)
- **Peso máximo:** < 500KB para carga rápida

## 💡 Consejos

1. **Optimiza tus imágenes** antes de subirlas (usa tinypng.com o similar)
2. **Mantén los nombres simples** y en minúsculas
3. **Usa la misma proporción** para todas las imágenes (2:3 es ideal)
4. **Si no tienes imagen**, deja el campo vacío `""` y se generará una automáticamente

## 🔍 Ejemplo Completo

```json
{
  "titulo": "El Señor de los Anillos",
  "autor": "J.R.R. Tolkien",
  "tipo": "libro",
  "calificacion": 5,
  "descripcion": "Una obra maestra de la fantasía épica...",
  "fecha": "2026-01-14",
  "imagen": "images/libros/senor-anillos.jpg"
}
```

---

**Nota:** Si prefieres usar URLs externas, también puedes hacerlo:
```json
"imagen": "https://ejemplo.com/mi-imagen.jpg"
```
