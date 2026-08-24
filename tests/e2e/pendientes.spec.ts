import { test, expect, type Page } from '@playwright/test';

/**
 * Lista de pendientes: alta desde el panel, visibilidad pública y conversión
 * en reseña. Se ejecuta en serie porque cada paso depende del anterior.
 */
test.describe.configure({ mode: 'serial' });

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'e2e@triangulodelectores.test';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'ClaveDePruebasE2E123';

const TITULO = `Pendiente E2E ${Date.now()}`;
const TITULO_OCULTO = `Reservado E2E ${Date.now()}`;

async function login(page: Page) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Contraseña').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await expect(page).toHaveURL(/\/admin$/);
}

test('1. se añade un pendiente desde el formulario rápido', async ({ page }) => {
  await login(page);
  await page.goto('/admin/pendientes');

  // Se acota al formulario rápido: la sección de alta por lotes tiene campos
  // con etiquetas parecidas.
  const alta = page.locator('form.quick-add');
  await alta.getByLabel('Título').fill(TITULO);
  await alta.getByLabel('Tipo').selectOption('GAME');
  await alta.getByLabel('Prioridad').selectOption('HIGH');
  await alta.getByLabel('Nota').fill('Añadido por el test E2E.');
  await alta.getByRole('button', { name: 'Añadir' }).click();

  await expect(page.getByRole('link', { name: TITULO })).toBeVisible();
});

test('2. aparece en la página pública', async ({ page }) => {
  await page.goto('/pendientes');
  await expect(page.getByRole('heading', { name: TITULO })).toBeVisible();
  await expect(page.getByText('Añadido por el test E2E.')).toBeVisible();
});

test('3. marcarlo en curso lo mueve a "Ahora mismo"', async ({ page }) => {
  await login(page);
  await page.goto('/admin/pendientes');
  await page
    .locator('.queue-item', { hasText: TITULO })
    .getByRole('button', { name: 'Empezar' })
    .click();

  await page.goto('/pendientes');
  await expect(page.getByRole('heading', { name: 'Ahora mismo' })).toBeVisible();
  await expect(page.locator('.pending', { hasText: TITULO }).getByText('En curso')).toBeVisible();
});

test('4. un pendiente privado no sale en público', async ({ page }) => {
  await login(page);
  await page.goto('/admin/pendientes');

  const alta = page.locator('form.quick-add');
  await alta.getByLabel('Título').fill(TITULO_OCULTO);
  await alta.getByLabel('Tipo').selectOption('BOOK');
  // La casilla "Público" viene marcada: se desmarca.
  await alta.locator('input[name="isPublic"]').uncheck();
  await alta.getByRole('button', { name: 'Añadir' }).click();

  await expect(page.locator('.queue-item', { hasText: TITULO_OCULTO }).getByText('Privado', { exact: true })).toBeVisible();

  await page.goto('/pendientes');
  await expect(page.getByRole('heading', { name: TITULO_OCULTO })).toHaveCount(0);
});

test('5. se convierte en borrador de reseña', async ({ page }) => {
  await login(page);
  await page.goto('/admin/pendientes');
  await page
    .locator('.queue-item', { hasText: TITULO })
    .getByRole('button', { name: 'Convertir en reseña' })
    .click();

  // Aterriza en el editor de la reseña recién creada, con los datos traídos.
  await expect(page).toHaveURL(/\/admin\/resenas\/[0-9a-f-]{36}/);
  await expect(page.locator('#f-titleEs')).toHaveValue(TITULO);
  await expect(page.locator('#f-status')).toHaveValue('DRAFT');
  await expect(page.locator('[data-rte-surface]')).toContainText('Añadido por el test E2E.');
});

test('6. el pendiente convertido sale de la cola pública', async ({ page }) => {
  await page.goto('/pendientes');
  await expect(page.getByRole('heading', { name: TITULO })).toHaveCount(0);

  await login(page);
  await page.goto('/admin/pendientes?status=DONE');
  await expect(page.locator('.queue-item', { hasText: TITULO }).getByText('Terminado')).toBeVisible();
});

test('7. se elimina de la lista', async ({ page }) => {
  await login(page);
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/admin/pendientes?status=ALL');
  await page
    .locator('.queue-item', { hasText: TITULO_OCULTO })
    .getByRole('button', { name: 'Eliminar' })
    .click();

  await expect(page.locator('.queue-item', { hasText: TITULO_OCULTO })).toHaveCount(0);
});
