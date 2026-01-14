# 💬 Sistema de Comentarios - Guía Rápida

Tu sitio ahora incluye un **sistema completo de comentarios** usando Giscus.

## 🎯 **¿Cómo Funciona?**

### **Para los lectores:**
1. Hacen clic en cualquier review
2. Leen la review completa en su propia página
3. Bajan hasta la sección de comentarios
4. Inician sesión con GitHub
5. ¡Dejan su comentario!

### **Para ti (moderador):**
1. Los comentarios se guardan en **GitHub Discussions**
2. Recibes notificaciones de nuevos comentarios
3. Puedes responder desde GitHub o desde el sitio
4. Moderas fácilmente desde tu repositorio

---

## 🚀 **Configuración Rápida (5 minutos)**

### **Paso 1:** Habilitar Discussions
- Ve a tu repo → Settings → Features
- Marca ✅ **Discussions**

### **Paso 2:** Instalar Giscus
- https://github.com/apps/giscus → Install
- Selecciona tu repositorio

### **Paso 3:** Configurar
- Ve a https://giscus.app/es
- Sigue los pasos
- Copia tu `data-repo-id` y `data-category-id`

### **Paso 4:** Editar código
- Abre `review-page.js`
- Completa los campos vacíos:
```javascript
repo: 'TU_USUARIO/trianguloDeLectores',
repoId: 'TU_REPO_ID',
categoryId: 'TU_CATEGORY_ID'
```

### **Paso 5:** ¡Listo!
```bash
git add review-page.js
git commit -m "Configura Giscus"
git push
```

---

## 📖 **Documentación Completa**

Lee `GISCUS_SETUP.md` para instrucciones detalladas paso a paso.

---

## ❓ **Preguntas Frecuentes**

**¿Necesitan cuenta de GitHub mis lectores?**
Sí, pero es gratis y toma 2 minutos crear una.

**¿Puedo usar otro sistema?**
Sí, pero Giscus es gratuito, sin anuncios y se integra perfectamente con GitHub Pages.

**¿Los comentarios son privados?**
No, son públicos y se guardan en GitHub Discussions de tu repositorio.

**¿Puedo moderar comentarios?**
Sí, desde GitHub Discussions puedes eliminar, editar y bloquear usuarios.

**¿Funciona sin configurar?**
No, necesitas completar la configuración en `review-page.js` primero.

---

## 🎨 **Características**

✅ **Comentarios anidados** - Respuestas organizadas
✅ **Reacciones** - 👍 ❤️ 😄 🎉 🚀
✅ **Markdown** - Formato de texto rico
✅ **Notificaciones** - Email cuando hay nuevos comentarios
✅ **Tema automático** - Se adapta a modo claro/oscuro
✅ **Sin anuncios** - Completamente gratis
✅ **Moderación fácil** - Desde GitHub

---

**¡Disfruta de las conversaciones con tus lectores! 💬**
