import { test, expect, type Page } from '@playwright/test';

/**
 * Recorrido completo del producto, en el orden en que lo vive una persona real:
 * login → crear reseña → portada → publicar → verla → comentar → responder →
 * reportar → alcanzar el umbral → moderar → eliminar → restaurar.
 *
 * Se ejecuta en serie porque cada paso depende del anterior.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e@triangulodelectores.test';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'ClaveDePruebasE2E123';

const TITULO = `Reseña E2E ${Date.now()}`;
let slug = '';
let reviewId = '';

/** PNG mínimo válido de 400x600, generado al vuelo (sin ficheros binarios en el repo). */
function pngBuffer(width = 400, height = 600): Buffer {
  const bytes = Buffer.alloc(512);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function login(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Contraseña').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test('1. el administrador inicia sesión', async ({ page }) => {
  await login(page);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('2-4. crea la reseña, sube portada y la publica', async ({ page }) => {
  await login(page);
  await page.goto('/admin/resenas/nueva');

  await page.getByLabel('Título en español').fill(TITULO);
  await page.locator('#f-contentType').selectOption('MOVIE');
  await page.locator('#f-year').fill('2024');
  await page.locator('#f-creator').fill('Dirección de prueba');
  await page.locator('#f-rating').selectOption('7'); // 3,5 estrellas
  await page.locator('#f-summary').fill('Resumen de la reseña de prueba.');

  // Editor enriquecido (contenteditable) + marca de spoiler.
  const surface = page.locator('[data-rte-surface]');
  await surface.click();
  await surface.fill('Este es el cuerpo de la reseña de prueba con contenido suficiente.');

  // Portada: se sube por fetch y rellena el campo oculto coverKey.
  await page.locator('[data-cover-input]').setInputFiles({
    name: 'portada.png',
    mimeType: 'image/png',
    buffer: pngBuffer(),
  });
  await expect(page.locator('[data-cover-key]')).toHaveValue(/reviews\/covers\//, { timeout: 15_000 });

  // Plataforma donde encontrarla.
  const primeraFila = page.locator('[data-platform-row]').first();
  await primeraFila.locator('select[name="platform_id"]').selectOption({ index: 1 });
  await primeraFila.locator('select[name="platform_availability"]').selectOption('SUBSCRIPTION');

  await page.locator('#f-status').selectOption('PUBLISHED');
  await page.getByRole('button', { name: 'Crear reseña' }).click();

  await expect(page).toHaveURL(/\/admin\/resenas\/[0-9a-f-]{36}/);
  reviewId = page.url().split('/').pop()!.split('?')[0]!;

  const slugInput = page.locator('#f-slug');
  slug = (await slugInput.inputValue()) || '';
  expect(slug.length).toBeGreaterThan(0);
});

test('5. la reseña es visible en el catálogo y en su modal', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: TITULO })).toBeVisible();

  // El modal se abre sin recargar y es accesible con teclado.
  await page.getByRole('link', { name: new RegExp(`Abrir reseña de ${TITULO}`) }).click();
  const modal = page.locator('[data-review-modal]');
  await expect(modal).toBeVisible();
  await expect(modal.getByText(TITULO)).toBeVisible();
  await expect(modal.getByText('Dónde verlo')).toBeVisible();

  // Media estrella visible.
  await expect(modal.locator('.star--half').first()).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
});

test('6. cualquiera puede comentar', async ({ page }) => {
  await page.goto(`/resena/${slug}`);
  await page.getByLabel('Tu nombre o alias').fill('Visitante E2E');
  await page.getByLabel('Tu comentario').fill('Comentario de prueba del recorrido E2E.');
  await page.getByRole('button', { name: 'Publicar comentario' }).click();

  await expect(page.locator('#toasts')).toContainText(/comentario/i, { timeout: 15_000 });
});

test('7. el administrador aprueba el comentario', async ({ page }) => {
  await login(page);
  await page.goto('/admin/comentarios?status=PENDING');
  await expect(page.getByText('Comentario de prueba del recorrido E2E.')).toBeVisible();
  await page
    .locator('.mod-item', { hasText: 'Comentario de prueba del recorrido E2E.' })
    .getByRole('button', { name: 'Aprobar' })
    .click();

  await page.goto(`/resena/${slug}`);
  await expect(page.getByText('Comentario de prueba del recorrido E2E.')).toBeVisible();
});

test('7b. otra persona responde al comentario', async ({ browser }) => {
  // Contexto sin sesión: con sesión iniciada el formulario no pide alias
  // (usa el nombre de la cuenta), así que aquí se prueba el caso anónimo.
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(`/resena/${slug}`);
  await expect(page.getByText('Comentario de prueba del recorrido E2E.')).toBeVisible();

  await page.getByRole('button', { name: 'Responder' }).first().click();
  const respuesta = page.locator('[data-reply-slot]:not([hidden])').first();
  await respuesta.getByLabel('Tu nombre o alias').fill('Otra persona');
  await respuesta.getByLabel('Tu respuesta').fill('Respuesta anidada de prueba.');
  await respuesta.getByRole('button', { name: 'Responder' }).click();
  await expect(page.locator('#toasts')).toContainText(/comentario|respuesta/i, { timeout: 15_000 });

  await context.close();
});

test('8-9. se reporta el comentario hasta alcanzar el umbral', async ({ browser }) => {
  // Cada contexto es una "persona" distinta: cookies independientes.
  for (let i = 0; i < 3; i++) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`/resena/${slug}`);

    // El formulario de reporte vive dentro de un <details>: se abre pulsando su
    // <summary> (funciona igual sin JavaScript).
    await page.locator('details.report > summary').first().click();
    const form = page.locator('[data-report-form]').first();
    await expect(form).toBeVisible();
    await form.locator('input[value="SPAM"]').check();
    await form.getByRole('button', { name: 'Enviar reporte' }).click();
    await expect(page.locator('#toasts')).toContainText(/reporte|gracias/i, { timeout: 15_000 });
    await context.close();
  }
});

test('10. el comentario aparece como reportado en moderación', async ({ page }) => {
  await login(page);
  await page.goto('/admin/comentarios?status=REPORTED');
  await expect(page.getByText('Comentario de prueba del recorrido E2E.')).toBeVisible();
  // El badge del contador de reportes, no el del estado ni el texto explicativo.
  await expect(
    page
      .locator('.mod-item', { hasText: 'Comentario de prueba del recorrido E2E.' })
      .getByText('3 reportes', { exact: true }),
  ).toBeVisible();
});

test('11. se elimina el comentario y el hilo se conserva', async ({ page }) => {
  await login(page);
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/admin/comentarios?status=ALL');
  await page
    .locator('.mod-item', { hasText: 'Comentario de prueba del recorrido E2E.' })
    .getByRole('button', { name: 'Eliminar' })
    .first()
    .click();

  await page.goto(`/resena/${slug}`);
  await expect(page.getByText('Este comentario ha sido eliminado.')).toBeVisible();
});

test('12. se restaura el comentario', async ({ page }) => {
  await login(page);
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/admin/comentarios?status=ALL');
  await page.locator('.mod-item').first().getByRole('button', { name: 'Restaurar' }).click();
  await expect(page.locator('.mod-item').first()).toBeVisible();
});

test('la reseña se puede despublicar y desaparece del catálogo', async ({ page }) => {
  await login(page);
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/admin/resenas');
  await page
    .locator('tr', { hasText: TITULO })
    .getByRole('button', { name: 'Despublicar' })
    .click();

  await page.goto('/');
  await expect(page.getByRole('heading', { name: TITULO })).toHaveCount(0);
  expect(reviewId).toMatch(/[0-9a-f-]{36}/);
});
