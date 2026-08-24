import type { FC } from 'hono/jsx';
import type { Category, Genre, Platform } from '../../../db/schema';
import { PLATFORM_KINDS, PLATFORM_KIND_LABELS } from '../../../types/domain';
import { AdminPage, CsrfField, Flash } from './shared';

export interface TaxonomyPageProps {
  categories: Category[];
  genres: Genre[];
  platforms: Platform[];
  csrfToken: string;
  flash?: { kind: 'ok' | 'error'; message: string } | null;
}

export const TaxonomyPage: FC<TaxonomyPageProps> = ({ categories, genres, platforms, csrfToken, flash }) => (
  <AdminPage title="Categorías, géneros y plataformas">
    {flash ? <Flash kind={flash.kind} message={flash.message} /> : null}

    <div class="admin-cols">
      <section class="panel">
        <h2 class="panel__title">Categorías</h2>
        <ul class="tax-list">
          {categories.map((category) => (
            <li class="tax-item">
              <form method="post" action={`/admin/taxonomias/categorias/${category.id}`} class="tax-form">
                <CsrfField token={csrfToken} />
                <input class="input" type="text" name="name" value={category.name} maxlength={80} required aria-label="Nombre" />
                <input class="input input--sm" type="number" name="sortOrder" value={category.sortOrder} min={0} max={9999} aria-label="Orden" />
                <label class="check">
                  <input type="checkbox" name="isActive" value="1" checked={category.isActive === 1} />
                  <span>Activa</span>
                </label>
                <button type="submit" class="btn btn--sm btn--ghost">
                  Guardar
                </button>
              </form>
              <form
                method="post"
                action={`/admin/taxonomias/categorias/${category.id}/eliminar`}
                class="inline-form"
                data-confirm={`¿Eliminar la categoría "${category.name}"? Las reseñas quedarán sin categoría.`}
              >
                <CsrfField token={csrfToken} />
                <button type="submit" class="btn btn--sm btn--danger">
                  ×
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form method="post" action="/admin/taxonomias/categorias" class="tax-create">
          <CsrfField token={csrfToken} />
          <input class="input" type="text" name="name" placeholder="Nueva categoría" maxlength={80} required />
          <button type="submit" class="btn btn--primary btn--sm">
            Añadir
          </button>
        </form>
      </section>

      <section class="panel">
        <h2 class="panel__title">Géneros</h2>
        <ul class="tax-list tax-list--chips">
          {genres.map((genre) => (
            <li class="tax-chip">
              <span>{genre.name}</span>
              <form
                method="post"
                action={`/admin/taxonomias/generos/${genre.id}/eliminar`}
                class="inline-form"
                data-confirm={`¿Eliminar el género "${genre.name}"?`}
              >
                <CsrfField token={csrfToken} />
                <button type="submit" class="btn btn--link btn--danger" aria-label={`Eliminar ${genre.name}`}>
                  ×
                </button>
              </form>
            </li>
          ))}
        </ul>
        <form method="post" action="/admin/taxonomias/generos" class="tax-create">
          <CsrfField token={csrfToken} />
          <input class="input" type="text" name="name" placeholder="Nuevo género" maxlength={60} required />
          <button type="submit" class="btn btn--primary btn--sm">
            Añadir
          </button>
        </form>
      </section>
    </div>

    <section class="panel">
      <h2 class="panel__title">Plataformas</h2>
      <table class="table table--admin">
        <thead>
          <tr>
            <th scope="col">Nombre</th>
            <th scope="col">Tipo</th>
            <th scope="col">URL base</th>
            <th scope="col">Activa</th>
            <th scope="col" />
          </tr>
        </thead>
        <tbody>
          {platforms.map((platform) => (
            <tr>
              <td colspan={5}>
                <form method="post" action={`/admin/taxonomias/plataformas/${platform.id}`} class="tax-form tax-form--wide">
                  <CsrfField token={csrfToken} />
                  <input class="input" type="text" name="name" value={platform.name} maxlength={80} required aria-label="Nombre" />
                  <select class="select" name="kind" aria-label="Tipo">
                    {PLATFORM_KINDS.map((kind) => (
                      <option value={kind} selected={platform.kind === kind}>
                        {PLATFORM_KIND_LABELS[kind]}
                      </option>
                    ))}
                  </select>
                  <input class="input" type="url" name="baseUrl" value={platform.baseUrl ?? ''} placeholder="https://…" maxlength={300} aria-label="URL base" />
                  <label class="check">
                    <input type="checkbox" name="isActive" value="1" checked={platform.isActive === 1} />
                    <span>Activa</span>
                  </label>
                  <button type="submit" class="btn btn--sm btn--ghost">
                    Guardar
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <form method="post" action="/admin/taxonomias/plataformas" class="tax-create">
        <CsrfField token={csrfToken} />
        <input class="input" type="text" name="name" placeholder="Nueva plataforma" maxlength={80} required />
        <select class="select" name="kind" aria-label="Tipo">
          {PLATFORM_KINDS.map((kind) => (
            <option value={kind}>{PLATFORM_KIND_LABELS[kind]}</option>
          ))}
        </select>
        <button type="submit" class="btn btn--primary btn--sm">
          Añadir
        </button>
      </form>
    </section>
  </AdminPage>
);
