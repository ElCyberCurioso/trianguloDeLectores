import type { FC } from 'hono/jsx';
import type { WatchlistRow } from '../../../db/repos/watchlist';
import type { Category } from '../../../db/schema';
import type { Bindings } from '../../../types/env';
import type { WatchlistInput } from '../../../validation/schemas';
import {
  CONTENT_TYPES, CONTENT_TYPE_LABELS, PRIORITIES, PRIORITY_LABELS,
  SERIAL_CONTENT_TYPES, WATCHLIST_STATUSES, WATCHLIST_STATUS_LABELS, isSerial,
} from '../../../types/domain';
import { yearRangeToInput } from '../../lib/year';
import { variantUrl } from '../../lib/images';
import { CsrfField, Field } from './ui';

/**
 * Un pendiente a medio escribir.
 *
 * El alta y la edición usan el mismo formulario: son los mismos campos y las
 * mismas reglas, y mantener dos copias garantizaba que una se quedara atrás
 * —que es justo lo que pasó con el año—. En el alta llega un esqueleto con los
 * valores por omisión en vez de una fila de la base.
 */
export type WatchlistDraft = Pick<
  WatchlistRow,
  | 'titleEs' | 'titleOriginal' | 'contentType' | 'categoryId' | 'year' | 'yearEnd'
  | 'yearOngoing' | 'seasons' | 'creator' | 'note' | 'sourceUrl' | 'priority'
  | 'status' | 'isPublic' | 'coverKey' | 'coverAlt' | 'sortOrder'
>;

export const EMPTY_WATCHLIST_DRAFT: WatchlistDraft = {
  titleEs: '',
  titleOriginal: null,
  contentType: 'MOVIE',
  categoryId: null,
  year: null,
  yearEnd: null,
  yearOngoing: 0,
  seasons: null,
  creator: null,
  note: null,
  sourceUrl: null,
  priority: 'MEDIUM',
  status: 'PENDING',
  isPublic: 1,
  coverKey: null,
  coverAlt: null,
  sortOrder: 0,
};

/**
 * De lo validado de vuelta al formulario.
 *
 * El formulario se pinta desde una fila de la base, y lo que hay tras un alta
 * o una edición fallidas es la entrada ya validada, que no es lo mismo: los
 * booleanos se guardan como 0 y 1, y lo que allí puede faltar aquí es nulo.
 * Traducirlo es lo que permite devolver la página con todo lo que se escribió.
 */
export function borradorDe(input: WatchlistInput): WatchlistDraft {
  return {
    titleEs: input.titleEs,
    titleOriginal: input.titleOriginal ?? null,
    contentType: input.contentType,
    categoryId: input.categoryId ?? null,
    year: input.year ?? null,
    yearEnd: input.yearEnd ?? null,
    yearOngoing: input.yearOngoing ? 1 : 0,
    seasons: input.seasons ?? null,
    creator: input.creator ?? null,
    note: input.note ?? null,
    sourceUrl: input.sourceUrl && input.sourceUrl.length ? input.sourceUrl : null,
    priority: input.priority,
    status: input.status,
    isPublic: input.isPublic ? 1 : 0,
    coverKey: input.coverKey ?? null,
    coverAlt: input.coverAlt ?? null,
    sortOrder: input.sortOrder,
  };
}

export interface WatchlistFormProps {
  env: Bindings;
  item: WatchlistDraft;
  categories: Category[];
  csrfToken: string;
  /** A dónde se envía. Alta y edición sólo se diferencian en esto. */
  action: string;
  submitLabel: string;
  cancelHref: string;
  errors?: Record<string, string>;
}

export const WatchlistForm: FC<WatchlistFormProps> = ({
  env,
  item,
  categories,
  csrfToken,
  action,
  submitLabel,
  cancelHref,
  errors = {},
}) => {
  const cover = variantUrl(env, item.coverKey, 'card');

  /*
   * Lo que sólo tiene sentido en lo que se emite por temporadas.
   *
   * Ni una película ni un libro tienen temporadas, y su año es un año y no un
   * periodo: pedirlo a todo llenaba la ficha de casillas que no aplican. Se
   * decide aquí, al pintar, y la isla lo rehace al cambiar el desplegable; sin
   * JavaScript se queda lo que corresponda al tipo guardado. Un campo con
   * error se enseña igual, o el mensaje se iría con el campo.
   */
  const serial = isSerial(item.contentType);
  const serialTypes = SERIAL_CONTENT_TYPES.join(' ');

  return (
    <form method="post" action={action} class="editor">
      <CsrfField token={csrfToken} />

      <div class="editor__grid">
        <div class="editor__main">
          <Field label="Título" name="titleEs" required error={errors.titleEs}>
            <input
              id="f-titleEs"
              class="input input--lg"
              type="text"
              name="titleEs"
              value={item.titleEs}
              required
              maxlength={200}
            />
          </Field>

          <div class="editor__row">
            <Field label="Título original" name="titleOriginal">
              <input
                id="f-titleOriginal"
                class="input"
                type="text"
                name="titleOriginal"
                value={item.titleOriginal ?? ''}
                maxlength={200}
              />
            </Field>
            <Field label="Autor / dirección / estudio" name="creator">
              <input id="f-creator" class="input" type="text" name="creator" value={item.creator ?? ''} maxlength={200} />
            </Field>
          </div>

          <Field label="Nota" name="note" hint="Por qué está en la lista, quién lo recomendó, qué esperas.">
            <textarea id="f-note" class="textarea" name="note" rows={4} maxlength={500}>
              {item.note ?? ''}
            </textarea>
          </Field>

          <Field label="Enlace" name="sourceUrl" hint="Ficha, tráiler o donde lo encontraste." error={errors.sourceUrl}>
            <input
              id="f-sourceUrl"
              class="input"
              type="url"
              name="sourceUrl"
              value={item.sourceUrl ?? ''}
              maxlength={500}
              placeholder="https://…"
            />
          </Field>
        </div>

        <aside class="editor__side">
          <section class="panel">
            <h2 class="panel__title">Estado</h2>

            <Field label="Situación" name="status">
              <select id="f-status" class="select" name="status">
                {WATCHLIST_STATUSES.map((status) => (
                  <option value={status} selected={item.status === status}>
                    {WATCHLIST_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Prioridad" name="priority">
              <select id="f-priority" class="select" name="priority">
                {PRIORITIES.map((priority) => (
                  <option value={priority} selected={item.priority === priority}>
                    {PRIORITY_LABELS[priority]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Orden manual" name="sortOrder" hint="Menor número, más arriba dentro de su prioridad.">
              <input
                id="f-sortOrder"
                class="input input--sm"
                type="number"
                name="sortOrder"
                value={item.sortOrder}
                min={0}
                max={9999}
              />
            </Field>

            <label class="check">
              <input type="checkbox" name="isPublic" value="1" checked={item.isPublic === 1} />
              <span>Visible en la página pública</span>
            </label>

            <div class="editor__submit">
              <button type="submit" class="btn btn--primary btn--block">
                {submitLabel}
              </button>
              <a class="btn btn--ghost btn--block" href={cancelHref}>
                Cancelar
              </a>
            </div>
          </section>

          <section class="panel">
            <h2 class="panel__title">Ficha</h2>

            <Field label="Tipo de contenido" name="contentType" required>
              <select
                id="f-contentType"
                class="select"
                name="contentType"
                required
                data-content-type
              >
                {CONTENT_TYPES.map((type) => (
                  <option value={type} selected={item.contentType === type}>
                    {CONTENT_TYPE_LABELS[type]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Categoría" name="categoryId">
              <select id="f-categoryId" class="select" name="categoryId">
                <option value="">Sin categoría</option>
                {categories.map((category) => (
                  <option value={category.id} selected={item.categoryId === category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </Field>

            {/*
              Un campo de texto y no un número: aquí cabe un año suelto y también
              un periodo. Partirlo en «desde», «hasta» y una casilla de «sigue
              en emisión» serían tres gestos para escribir lo que se dice de una
              vez, y en la mayoría de las fichas sólo hay un año que poner.

              El campo se queda siempre —todo tiene año—, pero el «o periodo» y
              su pista se destapan sólo en serie y anime. Va en un <span> dentro
              de la etiqueta y no en dos etiquetas distintas: así el cliente sólo
              tapa y destapa, y no hay dos textos que mantener. Por eso aquí no
              se usa <Field>, que compone la etiqueta de una pieza.
            */}
            <div class={`field${errors.year ? ' field--error' : ''}`}>
              <label class="field__label" for="f-year">
                Año
                <span data-types-only={serialTypes} hidden={!serial}> o periodo</span>
              </label>
              <input
                id="f-year"
                class="input"
                type="text"
                name="year"
                value={yearRangeToInput(item)}
                maxlength={40}
                placeholder={serial ? '2020-2022' : '2019'}
                data-placeholder-types={serialTypes}
                data-placeholder-on="2020-2022"
                data-placeholder-off="2019"
              />
              <p class="field__hint" data-types-only={serialTypes} hidden={!serial}>
                «1999», «2020-2022» o «2023-actualidad».
              </p>
              {errors.year ? (
                <p class="field__error" role="alert">
                  {errors.year}
                </p>
              ) : null}
            </div>

            <div
              data-types-only={serialTypes}
              data-keep-visible={errors.seasons ? '1' : undefined}
              hidden={!serial && !errors.seasons}
            >
              <Field label="Temporadas" name="seasons" hint="Sólo si las tiene." error={errors.seasons}>
                <input
                  id="f-seasons"
                  class="input input--sm"
                  type="number"
                  name="seasons"
                  value={item.seasons ?? ''}
                  min={1}
                  max={200}
                />
              </Field>
            </div>
          </section>

          <section class="panel">
            <h2 class="panel__title">Portada</h2>
            <div class="cover-uploader" data-cover-uploader>
              <div class="cover-uploader__preview">
                {cover ? (
                  <img src={cover} alt="Portada actual" data-cover-preview width="200" height="300" />
                ) : (
                  <div class="cover-uploader__empty" data-cover-preview-empty>
                    Sin portada
                  </div>
                )}
              </div>
              <input type="hidden" name="coverKey" value={item.coverKey ?? ''} data-cover-key />
              <label class="btn btn--ghost btn--block">
                <span>Subir imagen</span>
                <input
                  type="file"
                  class="visually-hidden"
                  accept="image/jpeg,image/png,image/webp,image/avif"
                  data-cover-input
                />
              </label>
              <button type="button" class="btn btn--link" data-cover-remove>
                Quitar portada
              </button>
              <Field label="Texto alternativo" name="coverAlt">
                <input
                  id="f-coverAlt"
                  class="input"
                  type="text"
                  name="coverAlt"
                  value={item.coverAlt ?? ''}
                  maxlength={200}
                />
              </Field>
            </div>
          </section>
        </aside>
      </div>
    </form>
  );
};
