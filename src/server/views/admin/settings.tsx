import type { FC } from 'hono/jsx';
import type { AppSettings } from '../../lib/settings';
import { AdminPage, CsrfField, Field, Flash } from './shared';
import { formatDateTime } from '../components/ui';

export interface SettingsPageProps {
  settings: AppSettings;
  csrfToken: string;
  users: Array<{
    id: string; email: string; displayName: string; role: string;
    status: string; lastLoginAt: number | null; createdAt: number;
  }>;
  environment: string;
  turnstileConfigured: boolean;
  flash?: { kind: 'ok' | 'error'; message: string } | null;
}

export const SettingsPage: FC<SettingsPageProps> = (props) => {
  const s = props.settings;
  return (
    <AdminPage title="Ajustes">
      {props.flash ? <Flash kind={props.flash.kind} message={props.flash.message} /> : null}

      <form method="post" action="/admin/ajustes" class="panel">
        <CsrfField token={props.csrfToken} />
        <h2 class="panel__title">Comentarios</h2>

        <Field label="Quién puede comentar" name="comments.mode">
          <select id="f-comments.mode" class="select" name="comments.mode">
            <option value="OPEN" selected={s['comments.mode'] === 'OPEN'}>
              Cualquiera (anónimo con alias)
            </option>
            <option value="AUTH" selected={s['comments.mode'] === 'AUTH'}>
              Sólo con sesión iniciada
            </option>
            <option value="CLOSED" selected={s['comments.mode'] === 'CLOSED'}>
              Cerrados
            </option>
          </select>
        </Field>

        <label class="check">
          <input type="checkbox" name="comments.require_approval" value="1" checked={s['comments.require_approval']} />
          <span>Los comentarios necesitan aprobación previa</span>
        </label>

        <div class="editor__row editor__row--3">
          <Field label="Profundidad máxima de respuestas" name="comments.max_depth">
            <input id="f-comments.max_depth" class="input" type="number" name="comments.max_depth" value={s['comments.max_depth']} min={1} max={10} />
          </Field>
          <Field label="Longitud mínima" name="comments.min_length">
            <input id="f-comments.min_length" class="input" type="number" name="comments.min_length" value={s['comments.min_length']} min={1} max={500} />
          </Field>
          <Field label="Longitud máxima" name="comments.max_length">
            <input id="f-comments.max_length" class="input" type="number" name="comments.max_length" value={s['comments.max_length']} min={50} max={10000} />
          </Field>
        </div>

        <h2 class="panel__title">Moderación</h2>
        <div class="editor__row">
          <Field
            label="Umbral de reportes"
            name="moderation.report_threshold"
            hint="Al alcanzarlo, el comentario pasa a REPORTED y aparece en el dashboard."
          >
            <input
              id="f-moderation.report_threshold"
              class="input"
              type="number"
              name="moderation.report_threshold"
              value={s['moderation.report_threshold']}
              min={1}
              max={100}
            />
          </Field>
          <Field
            label="Umbral de ocultación automática"
            name="moderation.auto_hide_threshold"
            hint="Con este número de reportes el comentario se oculta sin esperar revisión."
          >
            <input
              id="f-moderation.auto_hide_threshold"
              class="input"
              type="number"
              name="moderation.auto_hide_threshold"
              value={s['moderation.auto_hide_threshold']}
              min={1}
              max={1000}
            />
          </Field>
        </div>

        <h2 class="panel__title">Seguridad</h2>
        {!props.turnstileConfigured ? (
          <p class="flash flash--error">
            Turnstile no está configurado en este entorno (falta <code>TURNSTILE_SECRET_KEY</code> o
            <code> TURNSTILE_ENABLED</code>). Las casillas de abajo no tendrán efecto hasta configurarlo.
          </p>
        ) : null}
        <label class="check">
          <input type="checkbox" name="security.turnstile_login" value="1" checked={s['security.turnstile_login']} />
          <span>Turnstile en el login</span>
        </label>
        <label class="check">
          <input type="checkbox" name="security.turnstile_comments" value="1" checked={s['security.turnstile_comments']} />
          <span>Turnstile en los comentarios</span>
        </label>
        <label class="check">
          <input type="checkbox" name="security.turnstile_reports" value="1" checked={s['security.turnstile_reports']} />
          <span>Turnstile en los reportes</span>
        </label>

        <h2 class="panel__title">Sitio</h2>
        <Field label="Lema" name="site.tagline">
          <input id="f-site.tagline" class="input" type="text" name="site.tagline" value={s['site.tagline']} maxlength={200} />
        </Field>
        <Field label="Descripción (SEO)" name="site.description">
          <textarea id="f-site.description" class="textarea" name="site.description" rows={2} maxlength={400}>
            {s['site.description']}
          </textarea>
        </Field>
        <Field
          label="Retención del registro de auditoría (días)"
          name="privacy.audit_retention_days"
          hint="Las entradas más antiguas se eliminan automáticamente."
        >
          <input
            id="f-privacy.audit_retention_days"
            class="input"
            type="number"
            name="privacy.audit_retention_days"
            value={s['privacy.audit_retention_days']}
            min={7}
            max={3650}
          />
        </Field>

        <button type="submit" class="btn btn--primary">
          Guardar ajustes
        </button>
      </form>

      <section class="panel">
        <h2 class="panel__title">Usuarios</h2>
        <p class="field__hint">
          Entorno: <code>{props.environment}</code>. Los usuarios se crean por consola con{' '}
          <code>npm run admin:create</code>.
        </p>
        <table class="table table--admin">
          <thead>
            <tr>
              <th scope="col">Nombre</th>
              <th scope="col">Email</th>
              <th scope="col">Rol</th>
              <th scope="col">Estado</th>
              <th scope="col">Último acceso</th>
            </tr>
          </thead>
          <tbody>
            {props.users.map((user) => (
              <tr>
                <td>{user.displayName}</td>
                <td>{user.email}</td>
                <td>
                  <span class={`badge badge--${user.role === 'ADMIN' ? 'accent' : 'neutral'}`}>{user.role}</span>
                </td>
                <td>{user.status}</td>
                <td>{user.lastLoginAt ? formatDateTime(user.lastLoginAt) : 'nunca'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </AdminPage>
  );
};
