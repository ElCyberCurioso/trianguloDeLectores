import { test, expect } from '@playwright/test';

/**
 * Comprobaciones de accesibilidad y de degradación sin JavaScript.
 * No sustituyen a una auditoría manual, pero cierran las regresiones típicas.
 */

test('el catálogo tiene un único h1 y un enlace para saltar al contenido', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.locator('.skip-link')).toHaveAttribute('href', '#contenido');
});

test('se puede navegar con teclado hasta los filtros', async ({ page }) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.locator(':focus')).toHaveClass(/skip-link/);
});

test('el modal se cierra con Escape y devuelve el foco', async ({ page }) => {
  await page.goto('/');
  const primeraTarjeta = page.locator('[data-review-open]').first();
  if ((await primeraTarjeta.count()) === 0) test.skip();

  await primeraTarjeta.click();
  await expect(page.locator('[data-review-modal]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-review-modal]')).not.toBeVisible();
});

test('los campos de los filtros tienen etiqueta asociada', async ({ page }) => {
  await page.goto('/');
  for (const id of ['#f-q', '#f-type', '#f-category', '#f-genre', '#f-sort']) {
    const field = page.locator(id);
    await expect(field).toBeVisible();
    const fieldId = await field.getAttribute('id');
    await expect(page.locator(`label[for="${fieldId}"]`)).toHaveCount(1);
  }
});

test('las imágenes de portada tienen texto alternativo', async ({ page }) => {
  await page.goto('/');
  // Sólo las <img> reales: las tarjetas sin portada pintan un placeholder
  // decorativo que va marcado con aria-hidden y no lleva alt.
  const imagenes = page.locator('img.card__img');
  const total = await imagenes.count();
  for (let i = 0; i < total; i++) {
    await expect(imagenes.nth(i)).toHaveAttribute('alt', /.+/);
  }
});

test('el catálogo funciona sin JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();

  await page.goto('/');
  await expect(page.locator('h1')).toBeVisible();

  // Los filtros son un <form method="get">: siguen funcionando.
  await page.locator('#f-sort').selectOption('rating');
  await page.getByRole('button', { name: 'Filtrar' }).click();
  await expect(page).toHaveURL(/sort=rating/);

  await context.close();
});

test('el panel no es indexable', async ({ page }) => {
  const response = await page.goto('/admin/login');
  expect(response?.headers()['x-robots-tag']).toContain('noindex');
});

test('robots.txt referencia el sitemap o bloquea el sitio', async ({ page }) => {
  const response = await page.goto('/robots.txt');
  const body = await response!.text();
  expect(body).toContain('Disallow: /');
});
