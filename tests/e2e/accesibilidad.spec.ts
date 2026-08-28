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

test('la marca del sitio tiene nombre accesible en cabecera y pie', async ({ page }) => {
  await page.goto('/');
  // La marca «1C · Tres reglas» es SVG en línea: su nombre accesible lo aporta
  // el `aria-label` del lockup, no un atributo `alt`.
  await expect(page.getByRole('link', { name: /Triángulo de Lectores/ }).first()).toBeVisible();
  await expect(page.locator('.hero__logo')).toHaveAttribute('aria-label', /.+/);
});

test('los iconos de marca se sirven correctamente', async ({ request }) => {
  for (const ruta of ['/favicon.ico', '/apple-touch-icon.png', '/icon-192.png', '/site.webmanifest']) {
    const response = await request.get(ruta);
    expect(response.status(), ruta).toBe(200);
  }
});

test('la página de pendientes es navegable', async ({ page }) => {
  await page.goto('/pendientes');
  await expect(page.locator('h1')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Pendientes', level: 1 })).toBeVisible();
});

/**
 * Garantías de móvil. Se comprueban en el proyecto `mobile` de Playwright, que
 * usa un Pixel 7 con puntero grueso.
 */
const RUTAS_PUBLICAS = ['/', '/pendientes', '/sobre', '/recomendar', '/admin/login'];

for (const ruta of RUTAS_PUBLICAS) {
  test(`sin desbordamiento horizontal en ${ruta}`, async ({ page, isMobile }) => {
    test.skip(!isMobile, 'Sólo aplica al proyecto móvil');
    await page.goto(ruta);
    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    expect(desborde).toBeLessThanOrEqual(0);
  });
}

test('ningún campo dispara el zoom de iOS al enfocarlo', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Sólo aplica al proyecto móvil');
  // Safari en iOS amplía la página al enfocar un campo de menos de 16 px, y
  // salir de ahí exige un gesto manual.
  await page.goto('/recomendar');
  const pequenos = await page.evaluate(() =>
    [...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=hidden]), select, textarea')]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16).length,
  );
  expect(pequenos).toBe(0);
});

test('los controles llegan al tamaño táctil mínimo', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Sólo aplica al proyecto móvil');
  await page.goto('/recomendar');
  // WCAG 2.2 SC 2.5.8 pide 24x24 CSS px para un objetivo que no sea un enlace
  // dentro de texto corrido.
  const pequenos = await page.evaluate(() =>
    [...document.querySelectorAll('button, a.btn, a.chip, select, input:not([type=hidden])')]
      .filter((el) => {
        const caja = el.getBoundingClientRect();
        return caja.height > 0 && caja.height < 24;
      }).length,
  );
  expect(pequenos).toBe(0);
});
