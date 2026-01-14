# 🎯 Configuración de Giscus - Sistema de Comentarios

Esta guía te ayudará a configurar **Giscus** en tu sitio para que tus lectores puedan dejar comentarios en cada review.

## ⏱️ Tiempo estimado: 5-10 minutos

---

## 📋 **Prerrequisitos**

1. ✅ Tu repositorio debe ser **público** en GitHub
2. ✅ El repositorio debe estar en tu cuenta personal o una organización donde tengas permisos de admin

---

## 🚀 **Paso 1: Habilitar GitHub Discussions**

1. Ve a tu repositorio en GitHub: `https://github.com/TU_USUARIO/trianguloDeLectores`

2. Haz clic en **⚙️ Settings** (Configuración)

3. Baja hasta la sección **Features**

4. Marca la casilla **✅ Discussions**

5. Haz clic en **Set up discussions**

6. GitHub creará una discusión de bienvenida automáticamente

✅ **¡Listo!** Ahora tu repositorio tiene Discussions habilitadas.

---

## 🔧 **Paso 2: Instalar la App de Giscus**

1. Ve a: **[https://github.com/apps/giscus](https://github.com/apps/giscus)**

2. Haz clic en **Install** (Instalar)

3. Selecciona tu cuenta o organización

4. Elige:
   - **Only select repositories** → Selecciona `trianguloDeLectores`
   - O **All repositories** (si prefieres)

5. Haz clic en **Install**

✅ **¡Listo!** La app de Giscus ya está instalada.

---

## 📝 **Paso 3: Obtener tu Configuración**

1. Ve a: **[https://giscus.app/es](https://giscus.app/es)**

2. En la sección **"Configuración"**, completa:

### **Repositorio:**
```
TU_USUARIO/trianguloDeLectores
```
Reemplaza `TU_USUARIO` con tu nombre de usuario de GitHub.

### **Mapeo:**
Selecciona: **"specific term"** (término específico)

### **Categoría de Discussion:**
1. Giscus te mostrará las categorías disponibles
2. **Recomendado:** Crea una categoría llamada **"Reviews"**
   - Ve a tu repo → **Discussions** → **Categories** → **New category**
   - Nombre: `Reviews`
   - Descripción: `Comentarios sobre reviews`
3. Selecciona la categoría **"Reviews"** en Giscus

### **Características:**
- ✅ Enable reactions (Activar reacciones)
- ✅ Input position: **top** (parte superior)

### **Tema:**
- Selecciona: **"Preferred color scheme"** (esquema de color preferido)
- Esto hará que Giscus use automáticamente tu tema claro/oscuro

---

## 📋 **Paso 4: Copiar tu Configuración**

Giscus te mostrará un código como este:

```html
<script src="https://giscus.app/client.js"
        data-repo="TU_USUARIO/trianguloDeLectores"
        data-repo-id="R_kgDOxxxxxxx"
        data-category="Reviews"
        data-category-id="DIC_kwDOxxxxxxx"
        ...
</script>
```

**Copia estos valores:**
- `data-repo`: Tu repositorio
- `data-repo-id`: ID del repositorio (algo como `R_kgDOxxxxxxx`)
- `data-category`: "Reviews" (o el nombre que elegiste)
- `data-category-id`: ID de la categoría (algo como `DIC_kwDOxxxxxxx`)

---

## ⚙️ **Paso 5: Configurar en tu Código**

1. Abre el archivo `review-page.js`

2. Busca la sección que dice:

```javascript
const giscusConfig = {
    repo: '', // Usuario debe completar
    repoId: '', // Usuario debe obtener
    category: 'Reviews',
    categoryId: '', // Usuario debe obtener
    ...
};
```

3. **Completa con tus datos:**

```javascript
const giscusConfig = {
    repo: 'TU_USUARIO/trianguloDeLectores',
    repoId: 'R_kgDOxxxxxxx',  // Pega tu data-repo-id
    category: 'Reviews',
    categoryId: 'DIC_kwDOxxxxxxx',  // Pega tu data-category-id
    mapping: 'specific',
    term: `review-${reviewIndex}`,
    reactionsEnabled: '1',
    emitMetadata: '0',
    inputPosition: 'top',
    theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
    lang: 'es'
};
```

4. **Guarda el archivo**

---

## 🚀 **Paso 6: Subir los Cambios**

```bash
git add review-page.js
git commit -m "Configura Giscus para comentarios"
git push
```

---

## ✅ **Paso 7: ¡Probar!**

1. Espera 1-2 minutos para que GitHub Pages actualice

2. Ve a tu sitio: `https://TU_USUARIO.github.io/trianguloDeLectores`

3. Haz clic en cualquier review

4. Baja hasta la sección de **comentarios**

5. ¡Deberías ver el widget de Giscus!

6. **Prueba dejar un comentario:**
   - Haz clic en **"Sign in with GitHub"**
   - Autoriza la app
   - Escribe tu primer comentario

---

## 🎨 **Personalización (Opcional)**

### **Cambiar la categoría de Discussions:**

En `review-page.js`, cambia:
```javascript
category: 'General',  // En lugar de 'Reviews'
categoryId: 'TU_NUEVO_ID',
```

### **Cambiar el idioma:**

```javascript
lang: 'en'  // o 'es', 'pt', 'fr', etc.
```

### **Desactivar reacciones:**

```javascript
reactionsEnabled: '0',
```

---

## ❓ **Solución de Problemas**

### **"El widget no aparece"**

1. Verifica que completaste TODOS los campos en `review-page.js`
2. Asegúrate de que Discussions esté habilitado en tu repo
3. Verifica que la app de Giscus esté instalada
4. Limpia el caché del navegador (Ctrl+F5)

### **"No puedo comentar"**

1. Necesitas una cuenta de GitHub para comentar
2. Debes dar permisos a la app de Giscus
3. El repositorio debe ser público

### **"Los comentarios no se guardan"**

1. Verifica el `data-category-id` en tu configuración
2. Asegúrate de que la categoría existe en Discussions
3. Revisa los permisos de la app Giscus

### **"Aparece en inglés"**

Cambia `lang: 'en'` a `lang: 'es'` en `review-page.js`

---

## 🔒 **Moderación de Comentarios**

### **Ver comentarios:**
Ve a tu repositorio → **Discussions** → Categoría "Reviews"

### **Eliminar un comentario:**
1. Abre la discussion en GitHub
2. Haz clic en el menú ⋯ del comentario
3. Selecciona "Delete"

### **Editar un comentario:**
Solo el autor puede editar sus propios comentarios

### **Bloquear usuarios:**
1. Ve al perfil del usuario
2. Haz clic en ⋯
3. Selecciona "Block user"

---

## 📊 **Ventajas de usar Discussions**

✅ **Cada review tiene su propia discusión**
- `review-0`, `review-1`, etc.

✅ **Fácil de moderar**
- Todo desde GitHub

✅ **Los comentarios son tuyos**
- Almacenados en tu repositorio

✅ **Reacciones con emojis**
- 👍 ❤️ 😄 🎉

✅ **Soporte Markdown**
- Los usuarios pueden formatear sus comentarios

---

## 🎉 **¡Ya está!**

Tu sitio ahora tiene un sistema de comentarios completo y gratuito.

### **Próximos pasos:**

1. ✅ Avisa a tus lectores que pueden comentar
2. ✅ Responde a los comentarios desde GitHub
3. ✅ Modera activamente para mantener buenas conversaciones

---

## 🆘 **¿Necesitas Ayuda?**

- **Documentación oficial de Giscus:** https://giscus.app/es
- **GitHub Discussions docs:** https://docs.github.com/en/discussions
- **Problemas con Giscus:** https://github.com/giscus/giscus/discussions

---

**¡Disfruta de los comentarios en tu sitio! 💬✨**
