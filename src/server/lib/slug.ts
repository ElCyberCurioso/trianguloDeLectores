/** Genera slugs SEO estables a partir de títulos en español. */
export function slugify(input: string, maxLen = 80): string {
  const base = input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita diacríticos (á -> a)
    .replace(/[ñÑ]/g, 'n')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const cut = base.slice(0, maxLen).replace(/-+$/g, '');
  return cut || 'sin-titulo';
}

/** Sufija el slug hasta que `isFree` lo acepte (colisiones). */
export async function uniqueSlug(
  desired: string,
  isFree: (slug: string) => Promise<boolean>,
): Promise<string> {
  const base = slugify(desired);
  if (await isFree(base)) return base;
  for (let n = 2; n <= 50; n++) {
    const candidate = `${base}-${n}`;
    if (await isFree(candidate)) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}
