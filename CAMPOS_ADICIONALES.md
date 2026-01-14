# 📝 Guía de Campos Adicionales

Tu sitio ahora incluye campos adicionales para hacer las reviews mucho más completas e informativas.

## 🎯 **Campos Comunes (Todos los Tipos)**

### **Géneros/Temáticas**

Agrega un array de géneros para categorizar mejor tu contenido:

```json
"generos": ["Drama", "Ciencia ficción", "Thriller"]
```

**Ejemplos de géneros comunes:**
- **Libros:** Fantasía, Ciencia ficción, Romance, Thriller, Misterio, Terror, Histórico, Biografía
- **Series:** Drama, Comedia, Acción, Suspense, Documental, Animación
- **Películas:** Acción, Aventura, Comedia, Drama, Terror, Sci-Fi, Romance
- **Anime:** Shonen, Seinen, Slice of life, Isekai, Mecha, Romance

---

## 📚 **Libros - Campos Específicos**

### **Páginas**
```json
"paginas": 350
```
Número total de páginas del libro.

### **Editorial**
```json
"editorial": "Penguin Random House"
```
Nombre de la editorial (opcional, puede ser desconocida).

### **ISBN**
```json
"isbn": "978-0-307-47472-8"
```
Código ISBN del libro (si lo conoces). Útil para identificación única.

### **Ejemplo Completo:**

```json
{
  "titulo": "Cien años de soledad",
  "autor": "Gabriel García Márquez",
  "tipo": "libro",
  "calificacion": 5,
  "descripcion": "Una obra maestra del realismo mágico...",
  "fecha": "2026-01-10",
  "imagen": "",
  "estado": "publicado",
  "fecha_publicacion": "2026-01-10",
  "generos": ["Realismo mágico", "Ficción literaria", "Drama familiar"],
  "paginas": 471,
  "editorial": "Editorial Sudamericana",
  "isbn": "978-0307474728"
}
```

---

## 📺 **Series - Campos Específicos**

### **Temporadas**

Array con información de cada temporada:

```json
"temporadas": [
  { "numero": 1, "capitulos": 8 },
  { "numero": 2, "capitulos": 10 },
  { "numero": 3, "capitulos": 12 }
]
```

El sitio calculará automáticamente:
- Total de temporadas
- Total de capítulos

### **Ejemplo Completo:**

```json
{
  "titulo": "Breaking Bad",
  "autor": "Vince Gilligan",
  "tipo": "serie",
  "calificacion": 5,
  "descripcion": "Una de las mejores series de la historia...",
  "fecha": "2026-01-08",
  "imagen": "",
  "estado": "publicado",
  "fecha_publicacion": "2026-01-08",
  "generos": ["Drama", "Crimen", "Thriller"],
  "temporadas": [
    { "numero": 1, "capitulos": 7 },
    { "numero": 2, "capitulos": 13 },
    { "numero": 3, "capitulos": 13 },
    { "numero": 4, "capitulos": 13 },
    { "numero": 5, "capitulos": 16 }
  ]
}
```

---

## 🎬 **Películas - Campos Específicos**

### **Fecha de Estreno**

```json
"fecha_estreno": "2010-07-16"
```

Formato: `YYYY-MM-DD`

### **Ejemplo Completo:**

```json
{
  "titulo": "Inception",
  "autor": "Christopher Nolan",
  "tipo": "pelicula",
  "calificacion": 5,
  "descripcion": "Una obra maestra de ciencia ficción...",
  "fecha": "2026-01-05",
  "imagen": "",
  "estado": "publicado",
  "fecha_publicacion": "2026-01-05",
  "generos": ["Ciencia ficción", "Thriller", "Acción"],
  "fecha_estreno": "2010-07-16"
}
```

---

## 🎌 **Anime - Campos Específicos**

### **Temporada de Emisión**

Indica cuándo se emitió originalmente el anime:

```json
"temporada_anime": {
  "año": 2024,
  "temporada": "Primavera"
}
```

**Temporadas disponibles:**
- `"Invierno"` (Enero - Marzo)
- `"Primavera"` (Abril - Junio)
- `"Verano"` (Julio - Septiembre)
- `"Otoño"` (Octubre - Diciembre)

### **Ejemplo Completo:**

```json
{
  "titulo": "Attack on Titan",
  "autor": "Hajime Isayama / Wit Studio & MAPPA",
  "tipo": "anime",
  "calificacion": 5,
  "descripcion": "Una obra maestra del anime moderno...",
  "fecha": "2026-01-14",
  "imagen": "",
  "estado": "publicado",
  "fecha_publicacion": "2026-01-14",
  "generos": ["Acción", "Drama", "Fantasía oscura", "Misterio"],
  "temporada_anime": {
    "año": 2013,
    "temporada": "Primavera"
  }
}
```

---

## 🎨 **Visualización en el Sitio**

### **Dónde se muestran:**

Todos estos campos se muestran en la **página individual** de cada review, NO en el grid principal.

### **Ejemplo de cómo se ve:**

**Para un Libro:**
```
📚 Géneros
[Fantasía] [Aventura] [Magia]

📖 Información del Libro
Páginas: 662
Editorial: DAW Books
ISBN: 978-0756404741
```

**Para una Serie:**
```
📚 Géneros
[Drama] [Crimen] [Thriller]

📺 Información de la Serie
Total de temporadas: 5

Temporada 1 → 7 capítulos
Temporada 2 → 13 capítulos
Temporada 3 → 13 capítulos
Temporada 4 → 13 capítulos
Temporada 5 → 16 capítulos

Total: 62 capítulos
```

**Para una Película:**
```
📚 Géneros
[Ciencia ficción] [Thriller] [Acción]

🎬 Información de la Película
Fecha de estreno: 16 de julio de 2010
```

**Para un Anime:**
```
📚 Géneros
[Acción] [Drama] [Fantasía oscura]

🎌 Información del Anime
Temporada de emisión: Primavera 2013
```

---

## ❓ **Preguntas Frecuentes**

### **¿Son obligatorios estos campos?**
No, todos son opcionales. Si no los incluyes, simplemente no se mostrarán.

### **¿Puedo dejar algunos vacíos?**
Sí, solo agrega los que conozcas o consideres relevantes.

### **¿Qué pasa si no sé el ISBN?**
Déjalo vacío (`"isbn": ""`) o no lo incluyas en el JSON.

### **¿Puedo agregar más géneros?**
Sí, puedes agregar todos los que quieras en el array de géneros.

### **¿Cómo sé qué temporada es un anime?**
Busca en sitios como MyAnimeList o AniList la fecha de emisión original.

---

## 📊 **Tabla de Campos por Tipo**

| Campo | Libro | Serie | Película | Anime | Otro |
|-------|-------|-------|----------|-------|------|
| **generos** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **paginas** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **editorial** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **isbn** | ✅ | ❌ | ❌ | ❌ | ❌ |
| **temporadas** | ❌ | ✅ | ❌ | ❌ | ❌ |
| **fecha_estreno** | ❌ | ❌ | ✅ | ❌ | ❌ |
| **temporada_anime** | ❌ | ❌ | ❌ | ✅ | ❌ |

---

## 💡 **Tips**

1. **Siempre usa géneros** - Ayuda a los lectores a saber qué esperar
2. **Verifica el ISBN** - Búscalo en la contraportada del libro o en Google
3. **Para series largas** - Lista todas las temporadas, es útil para referencia
4. **Fechas correctas** - Usa el formato YYYY-MM-DD siempre
5. **Temporadas de anime** - Busca la primera emisión, no reboots

---

¡Con estos campos adicionales, tus reviews serán mucho más completas e informativas! 📚🎬📺🎌
