# 📅 Sistema de Publicación y Borradores

Tu sitio incluye un sistema completo para controlar **cuándo** y **cómo** se publican tus reviews.

## 🎯 Tres Opciones de Publicación

### 1️⃣ **Publicación Inmediata**

La review aparece en tu sitio tan pronto hagas push.

```json
{
  "titulo": "Mi Review",
  "autor": "Autor",
  "tipo": "libro",
  "calificacion": 5,
  "descripcion": "Una review genial...",
  "fecha": "2026-01-14",
  "imagen": "",
  "estado": "publicado",
  "fecha_publicacion": "2026-01-14"
}
```

**💡 Tip:** Si omites los campos `estado` y `fecha_publicacion`, por defecto se publicará inmediatamente.

---

### 2️⃣ **Borrador (No Publicado)**

La review está en `reviews.json` pero **NO aparece** en tu sitio.

```json
{
  "titulo": "Review en Proceso",
  "autor": "Autor",
  "tipo": "serie",
  "calificacion": 4,
  "descripcion": "Todavía estoy escribiendo esto...",
  "fecha": "2026-01-14",
  "imagen": "",
  "estado": "borrador",
  "fecha_publicacion": ""
}
```

**Cuándo publicarla:**
Simplemente cambia el estado a `"publicado"` cuando estés listo:

```json
"estado": "publicado",
"fecha_publicacion": "2026-01-14"
```

---

### 3️⃣ **Publicación Programada**

La review se publica **automáticamente** en una fecha futura.

```json
{
  "titulo": "Review del Futuro",
  "autor": "Autor",
  "tipo": "pelicula",
  "calificacion": 5,
  "descripcion": "Esta aparecerá el 1 de febrero...",
  "fecha": "2026-02-01",
  "imagen": "",
  "estado": "programado",
  "fecha_publicacion": "2026-02-01"
}
```

**¿Cómo funciona?**
- Puedes hacer push hoy con la fecha futura
- La review NO aparecerá hasta el 1 de febrero de 2026
- GitHub Pages mostrará automáticamente la review cuando llegue esa fecha

---

## 📝 Campos Explicados

| Campo | Valores | Descripción |
|-------|---------|-------------|
| **estado** | `"publicado"`, `"borrador"`, `"programado"` | Controla la visibilidad |
| **fecha_publicacion** | `"YYYY-MM-DD"` o `""` | Fecha en que se mostrará |

### Tabla de Comportamiento

| Estado | fecha_publicacion | Resultado |
|--------|-------------------|-----------|
| `"publicado"` | Cualquier fecha | ✅ Se muestra inmediatamente |
| `"borrador"` | Vacía `""` | ❌ No se muestra (indefinidamente) |
| `"programado"` | Fecha futura | ⏰ Se muestra cuando llegue la fecha |
| `"programado"` | Fecha pasada | ✅ Se muestra inmediatamente |

---

## 📂 Archivo `drafts.json` (Opcional)

Si prefieres mantener tus borradores **completamente separados**, puedes usar `drafts.json`:

### ¿Para qué sirve?

- **Organización personal**: Guarda reviews en proceso
- **No se publica**: Este archivo NO se carga en el sitio web
- **Privado**: Puedes agregarlo al `.gitignore` para no subirlo a GitHub

### Cómo usarlo

1. **Crea tus borradores en `drafts.json`**:

```json
{
  "borradores": [
    {
      "titulo": "Review en Desarrollo",
      "autor": "Autor",
      "tipo": "libro",
      "calificacion": 4,
      "descripcion": "Borrador de mi review...",
      "fecha": "2026-01-20",
      "imagen": "",
      "notas_privadas": "Recordar mencionar el capítulo 5"
    }
  ]
}
```

2. **Cuando esté lista, cópiala a `reviews.json`**:

```json
{
  "titulo": "Review en Desarrollo",
  "autor": "Autor",
  "tipo": "libro",
  "calificacion": 4,
  "descripcion": "Borrador de mi review...",
  "fecha": "2026-01-20",
  "imagen": "",
  "estado": "publicado",
  "fecha_publicacion": "2026-01-20"
}
```

3. **(Opcional) Elimínala de `drafts.json`**

---

## 🔒 Mantener Borradores Privados

Si no quieres subir `drafts.json` a GitHub:

1. **Descomenta esta línea en `.gitignore`**:

```gitignore
# Borradores (opcional - descomenta si no quieres subir tus borradores)
drafts.json
```

2. Cambia a:

```gitignore
# Borradores (opcional - descomenta si no quieres subir tus borradores)
drafts.json
```

Ahora tus borradores quedarán solo en tu computadora.

---

## 🚀 Flujo de Trabajo Recomendado

### Opción 1: Todo en `reviews.json`

```
1. Agrega review con estado: "borrador"
2. Edita y perfecciona
3. Cambia estado a "publicado"
4. git push
```

**Ventaja:** Todo en un solo archivo  
**Desventaja:** Los borradores están en el repositorio de GitHub

---

### Opción 2: Usar `drafts.json`

```
1. Agrega review a drafts.json
2. Edita y perfecciona
3. Copia a reviews.json con estado: "publicado"
4. git push
```

**Ventaja:** Borradores privados (si usas `.gitignore`)  
**Desventaja:** Tienes que mover manualmente entre archivos

---

### Opción 3: Publicación Programada

```
1. Agrega review con estado: "programado"
2. Establece fecha_publicacion futura
3. git push AHORA
4. La review aparece automáticamente en la fecha indicada
```

**Ventaja:** Programa contenido con anticipación  
**Desventaja:** Necesitas planificar las fechas

---

## 💡 Casos de Uso

### Escribir varias reviews de una vez

```json
{
  "reviews": [
    {
  "titulo": "Review de Libro",
  "tipo": "libro",
  "estado": "programado",
  "fecha_publicacion": "2026-01-20"
},
    {
  "titulo": "Review de Anime",
  "tipo": "anime",
  "estado": "programado",
  "fecha_publicacion": "2026-01-27"
},
    {
      "titulo": "Review 3",
      "estado": "programado",
      "fecha_publicacion": "2026-02-03"
    }
  ]
}
```

Haz push una vez y tendrás contenido para 3 semanas.

---

### Trabajar en una review compleja

```json
{
  "titulo": "Análisis Profundo",
  "estado": "borrador",
  "fecha_publicacion": ""
}
```

Edita tranquilamente sin presión. Publica cuando esté perfecta.

---

### Calendario de contenido

Usa `estado: "programado"` para crear un calendario editorial:

- Lunes: Review de libro
- Miércoles: Review de serie
- Viernes: Review de película

---

## ❓ Preguntas Frecuentes

**¿Puedo cambiar una review publicada a borrador?**  
Sí, solo cambia `"estado": "publicado"` a `"estado": "borrador"` y desaparecerá del sitio.

**¿Qué pasa si programo una review y luego quiero publicarla antes?**  
Cambia el estado a `"publicado"` y aparecerá inmediatamente.

**¿Los borradores ocupan espacio en mi sitio?**  
No, los borradores se filtran antes de mostrarse. No afectan el rendimiento.

**¿Puedo ver mis borradores en algún lugar?**  
No en el sitio público. Solo puedes verlos editando `reviews.json` directamente.

**¿GitHub Pages actualiza automáticamente las reviews programadas?**  
Sí, el sistema verifica la fecha cada vez que alguien visita el sitio.

---

## 🎓 Ejemplo Completo

```json
{
  "reviews": [
    {
      "titulo": "Review Publicada",
      "tipo": "libro",
      "calificacion": 5,
      "estado": "publicado",
      "fecha_publicacion": "2026-01-10"
    },
    {
      "titulo": "Trabajando en Esto",
      "tipo": "serie",
      "calificacion": 4,
      "estado": "borrador",
      "fecha_publicacion": ""
    },
    {
      "titulo": "Se Publica el Lunes",
      "tipo": "pelicula",
      "calificacion": 4.5,
      "estado": "programado",
      "fecha_publicacion": "2026-01-20"
    }
  ]
}
```

**Resultado en el sitio HOY (14 de enero):**
- ✅ "Review Publicada" - Visible
- ❌ "Trabajando en Esto" - Oculto
- ❌ "Se Publica el Lunes" - Oculto hasta el 20/01

**Resultado el 20 de enero:**
- ✅ "Review Publicada" - Visible
- ❌ "Trabajando en Esto" - Oculto
- ✅ "Se Publica el Lunes" - Visible

---

¡Ya tienes control total sobre tu contenido! 🎉
