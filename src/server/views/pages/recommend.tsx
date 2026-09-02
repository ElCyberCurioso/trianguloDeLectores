import type { FC } from 'hono/jsx';
import { CONTENT_TYPES, CONTENT_TYPE_LABELS } from '../../../types/domain';
import { Icon } from '../components/icons';
import { TurnstileSlot } from '../components/ui';

export interface RecommendPageProps {
  /** Token de formulario firmado: cierra el envío automático desde fuera. */
  formToken: string;
  turnstileSiteKey: string | null;
  /** Cuántas propuestas ya han acabado en el catálogo. */
  aceptadas: number;
  enviada?: boolean;
  error?: string | null;
}

/**
 * Sección pública de recomendaciones.
 *
 * Lo que se envía no se publica: entra en una bandeja interna. Se dice sin
 * rodeos en la propia página, porque prometer lo contrario sería mentir.
 */
export const RecommendPage: FC<RecommendPageProps> = ({
  formToken, turnstileSiteKey, aceptadas, enviada = false, error = null,
}) => (
  <div class="wrap recommend">
    <header class="recommend__head">
      <p class="eyebrow">Recomendaciones</p>
      <h1 class="recommend__title">¿Qué deberíamos leer, ver o jugar?</h1>
      <p class="recommend__intro">
        Cuenta qué te ha gustado y por qué. Cada propuesta se lee a mano: algunas acaban
        en la lista de pendientes y otras, directamente en una reseña.
      </p>
      {aceptadas > 0 ? (
        <p class="recommend__stat">
          <b>{aceptadas}</b> {aceptadas === 1 ? 'recomendación aceptada' : 'recomendaciones aceptadas'} hasta ahora
        </p>
      ) : null}
    </header>

    {enviada ? (
      <p class="flash flash--ok" role="status">
        <strong>Recibida.</strong> La leeremos con calma. Si entra en la cola, aparecerá en
        la lista de pendientes.
      </p>
    ) : null}

    {error ? (
      <p class="flash flash--error" role="alert">
        {error}
      </p>
    ) : null}

    <form class="recommend__form" method="post" action="/api/recomendaciones">
      <input type="hidden" name="_form" value={formToken} />

      {/* Trampa para robots: quien rellene esto no es una persona. */}
      <div class="hp" aria-hidden="true">
        <label>
          No rellenes este campo
          <input type="text" name="website" tabindex={-1} autocomplete="off" />
        </label>
      </div>

      <div class="recommend__row">
        <div class="field">
          <label class="field__label" for="r-title">
            Qué recomiendas <span class="field__req" aria-hidden="true">*</span>
          </label>
          <input id="r-title" class="input" type="text" name="titleEs" required minlength={2} maxlength={200} />
        </div>

        <div class="field">
          <label class="field__label" for="r-type">
            Tipo <span class="field__req" aria-hidden="true">*</span>
          </label>
          <select id="r-type" class="select" name="contentType" required>
            {CONTENT_TYPES.map((type) => (
              <option value={type}>{CONTENT_TYPE_LABELS[type]}</option>
            ))}
          </select>
        </div>
      </div>

      <div class="recommend__row">
        <div class="field">
          <label class="field__label" for="r-creator">
            Autoría o estudio
          </label>
          <input id="r-creator" class="input" type="text" name="creator" maxlength={200} />
        </div>

        <div class="field">
          <label class="field__label" for="r-year">
            Año
          </label>
          <input id="r-year" class="input" type="number" name="year" min={1400} max={2200} />
        </div>
      </div>

      <div class="field">
        <label class="field__label" for="r-note">
          Por qué la recomiendas <span class="field__req" aria-hidden="true">*</span>
        </label>
        <textarea
          id="r-note"
          class="textarea"
          name="note"
          rows={5}
          required
          minlength={10}
          maxlength={1500}
          placeholder="Sin spoilers, por favor. Qué te sorprendió, a quién se la darías."
        />
        <p class="field__hint">Entre 10 y 1500 caracteres.</p>
      </div>

      <div class="recommend__row">
        <div class="field">
          <label class="field__label" for="r-url">
            Enlace a una ficha (opcional)
          </label>
          <input id="r-url" class="input" type="url" name="sourceUrl" maxlength={500} placeholder="https://" />
        </div>

        <div class="field">
          <label class="field__label" for="r-alias">
            Tu nombre o alias (opcional)
          </label>
          <input id="r-alias" class="input" type="text" name="alias" maxlength={60} />
          <p class="field__hint">Si lo dejas en blanco, la propuesta llega sin firma.</p>
        </div>
      </div>

      {turnstileSiteKey ? (
        <TurnstileSlot siteKey={turnstileSiteKey} />
      ) : null}

      <div class="recommend__actions">
        <button type="submit" class="btn btn--primary">
          <Icon name="bookmark" size={15} />
          Enviar recomendación
        </button>
        <p class="recommend__legal">
          No guardamos tu dirección IP en claro, sólo un valor derivado que sirve para
          frenar el abuso. Ver la <a href="/privacidad">política de privacidad</a>.
        </p>
      </div>
    </form>
  </div>
);
