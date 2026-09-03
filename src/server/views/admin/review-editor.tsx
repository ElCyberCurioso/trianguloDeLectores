import type { FC } from 'hono/jsx';
import { raw } from 'hono/html';
import type { ReviewDetail } from '../../../db/repos/reviews';
import type { Category, Genre, Platform } from '../../../db/schema';
import type { Bindings } from '../../../types/env';
import {
  CONTENT_TYPES, CONTENT_TYPE_LABELS, AVAILABILITY, AVAILABILITY_LABELS,
  MAX_SCORE_HALF, formatScore,
} from '../../../types/domain';
import { variantUrl } from '../../lib/images';
import { Icon } from '../components/icons';
import { AdminPage, CsrfField, Field, Flash } from './shared';

export interface ReviewEditorProps {
  env: Bindings;
  review: ReviewDetail | null;
  categories: Category[];
  genres: Genre[];
  platforms: Platform[];
  csrfToken: string;
  errors?: Record<string, string>;
  flash?: { kind: 'ok' | 'error'; message: string } | null;
}

export const ReviewEditorPage: FC<ReviewEditorProps> = (props) => {
  const { review, categories, genres, platforms, csrfToken, errors = {}, env } = props;
  const isNew = review === null;
  const action = isNew ? '/admin/resenas/nueva' : `/admin/resenas/${review.id}`;
  const cover = variantUrl(env, review?.coverKey, 'card');
  const selectedGenres = new Set(review?.genres.map((g) => g.id) ?? []);

  return (
    <AdminPage
      title={isNew ? 'Nueva reseña' : 'Editar reseña'}
      actions={
        !isNew ? (
          <>
            <a class="btn btn--ghost" href={`/resena/${review.slug}`} target="_blank" rel="noopener">
              Ver
            </a>
            <form method="post" action={`/admin/resenas/${review.id}/duplicar`} class="inline-form">
              <CsrfField token={csrfToken} />
              <button type="submit" class="btn btn--ghost">
                Duplicar
              </button>
            </form>
            <form
              method="post"
              action={`/admin/resenas/${review.id}/eliminar`}
              class="inline-form"
              data-confirm="¿Eliminar esta reseña? Se podrá restaurar desde la papelera."
            >
              <CsrfField token={csrfToken} />
              <button type="submit" class="btn btn--danger">
                Eliminar
              </button>
            </form>
          </>
        ) : null
      }
    >
      {props.flash ? <Flash kind={props.flash.kind} message={props.flash.message} /> : null}

      <form method="post" action={action} class="editor" data-review-editor enctype="multipart/form-data">
        <CsrfField token={csrfToken} />

        <div class="editor__grid">
          <div class="editor__main">
            <Field label="Título en español" name="titleEs" required error={errors.titleEs}>
              <input
                id="f-titleEs"
                class="input input--lg"
                type="text"
                name="titleEs"
                value={review?.titleEs ?? ''}
                required
                maxlength={200}
              />
            </Field>

            <div class="editor__row">
              <Field label="Título original" name="titleOriginal" error={errors.titleOriginal}>
                <input
                  id="f-titleOriginal"
                  class="input"
                  type="text"
                  name="titleOriginal"
                  value={review?.titleOriginal ?? ''}
                  maxlength={200}
                />
              </Field>
              <Field
                label="Otros títulos"
                name="otherTitles"
                hint="Separados por punto y coma."
                error={errors.otherTitles}
              >
                <input
                  id="f-otherTitles"
                  class="input"
                  type="text"
                  name="otherTitles"
                  value={review?.otherTitles.join('; ') ?? ''}
                  maxlength={600}
                />
              </Field>
            </div>

            <Field label="Resumen" name="summary" hint="Extracto que aparece en las tarjetas del catálogo." error={errors.summary}>
              <textarea id="f-summary" class="textarea" name="summary" rows={3} maxlength={600}>
                {review?.summary ?? ''}
              </textarea>
            </Field>

            <Field label="Reseña" name="bodyHtml" error={errors.bodyHtml}>
              <div class="rte" data-rte>
                <div class="rte__toolbar" role="toolbar" aria-label="Formato de texto">
                  <button type="button" class="rte__btn" data-rte-cmd="formatBlock" data-rte-arg="h2" title="Título">
                    H2
                  </button>
                  <button type="button" class="rte__btn" data-rte-cmd="formatBlock" data-rte-arg="h3" title="Subtítulo">
                    H3
                  </button>
                  <button type="button" class="rte__btn" data-rte-cmd="bold" title="Negrita">
                    <strong>B</strong>
                  </button>
                  <button type="button" class="rte__btn" data-rte-cmd="italic" title="Cursiva">
                    <em>I</em>
                  </button>
                  <button type="button" class="rte__btn" data-rte-cmd="insertUnorderedList" title="Lista">
                    • Lista
                  </button>
                  <button type="button" class="rte__btn" data-rte-cmd="insertOrderedList" title="Lista numerada">
                    1. Lista
                  </button>
                  <button type="button" class="rte__btn" data-rte-cmd="formatBlock" data-rte-arg="blockquote" title="Cita">
                    ❝
                  </button>
                  <button type="button" class="rte__btn" data-rte-link title="Enlace">
                    🔗
                  </button>
                  <button type="button" class="rte__btn" data-rte-image title="Insertar imagen">
                    🖼
                  </button>
                  <button type="button" class="rte__btn rte__btn--spoiler" data-rte-spoiler title="Marcar como spoiler">
                    Spoiler
                  </button>
                  <button type="button" class="rte__btn" data-rte-cmd="removeFormat" title="Limpiar formato">
                    ⌫
                  </button>
                </div>
                <div
                  class="rte__surface prose"
                  contenteditable={true}
                  role="textbox"
                  aria-multiline="true"
                  aria-label="Contenido de la reseña"
                  data-rte-surface
                >
                  {raw(review?.bodyHtml ?? '<p></p>')}
                </div>
                {/* El HTML se vuelve a sanear en servidor antes de guardarse. */}
                <textarea class="visually-hidden" name="bodyHtml" data-rte-input aria-hidden="true" tabindex={-1}>
                  {review?.bodyHtml ?? ''}
                </textarea>
              </div>
            </Field>
          </div>

          <aside class="editor__side">
            <section class="panel">
              <h2 class="panel__title">Publicación</h2>
              <Field label="Estado" name="status">
                <select id="f-status" class="select" name="status">
                  <option value="DRAFT" selected={review?.status !== 'PUBLISHED'}>
                    Borrador
                  </option>
                  <option value="PUBLISHED" selected={review?.status === 'PUBLISHED'}>
                    Publicada
                  </option>
                </select>
              </Field>

              <EstrellasNota half={review?.ratingHalf ?? 0} />

              <label class="check">
                <input type="checkbox" name="hasSpoilers" value="1" checked={review?.hasSpoilers === 1} />
                <span>Esta reseña contiene spoilers</span>
              </label>

              <Field label="Comentarios" name="commentsMode">
                <select id="f-commentsMode" class="select" name="commentsMode">
                  <option value="INHERIT" selected={(review?.commentsMode ?? 'INHERIT') === 'INHERIT'}>
                    Según ajustes globales
                  </option>
                  <option value="OPEN" selected={review?.commentsMode === 'OPEN'}>
                    Abiertos (anónimos)
                  </option>
                  <option value="AUTH" selected={review?.commentsMode === 'AUTH'}>
                    Sólo con sesión
                  </option>
                  <option value="CLOSED" selected={review?.commentsMode === 'CLOSED'}>
                    Cerrados
                  </option>
                </select>
              </Field>

              <div class="editor__submit">
                <button type="submit" class="btn btn--primary btn--block">
                  {isNew ? 'Crear reseña' : 'Guardar cambios'}
                </button>
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
                <input type="hidden" name="coverKey" value={review?.coverKey ?? ''} data-cover-key />
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
                <p class="field__hint">JPEG, PNG, WebP o AVIF. Máximo 5 MB.</p>
                <Field label="Texto alternativo" name="coverAlt">
                  <input
                    id="f-coverAlt"
                    class="input"
                    type="text"
                    name="coverAlt"
                    value={review?.coverAlt ?? ''}
                    maxlength={200}
                  />
                </Field>
              </div>
            </section>

            <section class="panel">
              <h2 class="panel__title">Ficha</h2>
              <Field label="Tipo de contenido" name="contentType" required>
                <select id="f-contentType" class="select" name="contentType" required>
                  {CONTENT_TYPES.map((type) => (
                    <option value={type} selected={review?.contentType === type}>
                      {CONTENT_TYPE_LABELS[type]}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Categoría" name="categoryId">
                <select id="f-categoryId" class="select" name="categoryId">
                  <option value="">Sin categoría</option>
                  {categories.map((category) => (
                    <option value={category.id} selected={review?.categoryId === category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </Field>

              <div class="editor__row">
                <Field label="Año" name="year" error={errors.year}>
                  <input id="f-year" class="input" type="number" name="year" value={review?.year ?? ''} min={1400} max={2200} />
                </Field>
                <Field label="País" name="country">
                  <input id="f-country" class="input" type="text" name="country" value={review?.country ?? ''} maxlength={100} />
                </Field>
              </div>

              <Field label="Autor / director / creador" name="creator">
                <input id="f-creator" class="input" type="text" name="creator" value={review?.creator ?? ''} maxlength={200} />
              </Field>

              <div class="editor__row editor__row--3">
                <Field label="Duración (min)" name="durationMin">
                  <input id="f-durationMin" class="input" type="number" name="durationMin" value={review?.durationMin ?? ''} min={1} />
                </Field>
                <Field label="Episodios" name="episodes">
                  <input id="f-episodes" class="input" type="number" name="episodes" value={review?.episodes ?? ''} min={1} />
                </Field>
                <Field label="Volúmenes" name="volumes">
                  <input id="f-volumes" class="input" type="number" name="volumes" value={review?.volumes ?? ''} min={1} />
                </Field>
              </div>
            </section>

            <section class="panel">
              <h2 class="panel__title">Géneros</h2>
              <div class="checks">
                {genres.map((genre) => (
                  <label class="check">
                    <input type="checkbox" name="genreIds" value={genre.id} checked={selectedGenres.has(genre.id)} />
                    <span>{genre.name}</span>
                  </label>
                ))}
              </div>
              {genres.length === 0 ? (
                <p class="panel__empty">
                  No hay géneros. <a href="/admin/taxonomias">Crear géneros</a>
                </p>
              ) : null}
            </section>

            <section class="panel">
              <h2 class="panel__title">SEO</h2>
              <Field label="Slug" name="slug" hint="Se genera del título si lo dejas vacío.">
                <input id="f-slug" class="input" type="text" name="slug" value={review?.slug ?? ''} maxlength={90} />
              </Field>
              <Field label="Title SEO" name="seoTitle">
                <input id="f-seoTitle" class="input" type="text" name="seoTitle" value={review?.seoTitle ?? ''} maxlength={70} />
              </Field>
              <Field label="Meta description" name="seoDescription">
                <textarea id="f-seoDescription" class="textarea" name="seoDescription" rows={2} maxlength={180}>
                  {review?.seoDescription ?? ''}
                </textarea>
              </Field>
            </section>
          </aside>
        </div>

        <section class="panel">
          <h2 class="panel__title">Dónde verlo / dónde encontrarlo</h2>
          <div class="platform-rows" data-platform-rows>
            {(review?.platforms ?? []).map((entry, index) => (
              <PlatformRow platforms={platforms} index={index} value={entry} />
            ))}
            <PlatformRow platforms={platforms} index={review?.platforms.length ?? 0} value={null} />
          </div>
          <button type="button" class="btn btn--ghost" data-platform-add>
            Añadir plataforma
          </button>
          <template data-platform-template>
            <PlatformRow platforms={platforms} index={-1} value={null} />
          </template>
        </section>
      </form>
    </AdminPage>
  );
};

const PlatformRow: FC<{
  platforms: Platform[];
  index: number;
  value: { platformId: string; url: string | null; availability: string; note: string | null } | null;
}> = ({ platforms, index, value }) => (
  <div class="platform-row" data-platform-row data-index={index}>
    <select class="select" name="platform_id" aria-label="Plataforma">
      <option value="">— Ninguna —</option>
      {platforms.map((platform) => (
        <option value={platform.id} selected={value?.platformId === platform.id}>
          {platform.name}
        </option>
      ))}
    </select>
    <select class="select" name="platform_availability" aria-label="Disponibilidad">
      {AVAILABILITY.map((availability) => (
        <option value={availability} selected={value?.availability === availability}>
          {AVAILABILITY_LABELS[availability]}
        </option>
      ))}
    </select>
    <input class="input" type="url" name="platform_url" value={value?.url ?? ''} placeholder="https://…" maxlength={500} aria-label="URL" />
    <input class="input" type="text" name="platform_note" value={value?.note ?? ''} placeholder="Nota" maxlength={120} aria-label="Nota" />
    <button type="button" class="btn btn--link btn--danger" data-platform-remove aria-label="Quitar plataforma">
      ×
    </button>
  </div>
);


/**
 * La nota, en estrellas y con medio punto.
 *
 * Debajo hay un `input[type=range]` de verdad, no un puñado de botones: es lo
 * que hace que el control funcione **sin JavaScript**, se pueda usar con el
 * teclado (las flechas mueven de medio en medio) y tenga un objetivo táctil
 * grande en un teléfono, donde diez estrellas partidas por la mitad dejarían
 * zonas de pulsación de quince píxeles.
 *
 * Las estrellas son la piel: dos capas idénticas superpuestas —una apagada y
 * otra en acento— de las que la de acento se recorta al ancho que corresponde a
 * la nota. Ese ancho lo fija el CSS a partir de `data-half`, no un `style=`:
 * la CSP no lleva `unsafe-inline` y los valores dinámicos van por atributos
 * `data-*`.
 *
 * Sin JavaScript el relleno se queda en el valor guardado hasta que se envía el
 * formulario. El control sigue siendo utilizable: lo que no se mueve es el
 * adorno, no la nota.
 */
const EstrellasNota: FC<{ half: number }> = ({ half }) => (
  <div class="field">
    <label class="field__label" for="f-ratingHalf">
      Puntuación
    </label>

    <div class="rating" data-rating data-half={half}>
      <input
        id="f-ratingHalf"
        class="rating__range"
        type="range"
        name="ratingHalf"
        min={0}
        max={MAX_SCORE_HALF}
        step={1}
        value={half}
        data-rating-range
        // Un lector de pantalla leería «15 de 20», que no es la nota de nadie.
        aria-valuetext={`${formatScore(half)} sobre 10`}
      />

      <div class="rating__stars" data-rating-stars aria-hidden="true">
        <div class="rating__layer rating__layer--base">
          {Array.from({ length: 10 }).map(() => (
            <Icon name="star" class="rating__star" />
          ))}
        </div>
        <div class="rating__layer rating__layer--fill">
          {Array.from({ length: 10 }).map(() => (
            <Icon name="star" class="rating__star" />
          ))}
        </div>
      </div>

      <output class="rating__value" for="f-ratingHalf" data-rating-output>
        {formatScore(half)}
      </output>

      {/*
        Con el ratón no hay forma de volver a «sin nota»: pulsar en el borde
        izquierdo del todo da media estrella, no cero. Con el teclado sí (Inicio
        o flecha abajo), pero eso no lo sabe nadie.

        Nace oculto y lo destapa la isla del navegador: sin JavaScript sería un
        botón que no hace nada, y un control muerto es peor que uno ausente.
      */}
      <button type="button" class="rating__clear" data-rating-clear hidden>
        Quitar la nota
      </button>
    </div>

    <p class="field__hint">De 0 a 10, con medio punto de precisión.</p>
  </div>
);
