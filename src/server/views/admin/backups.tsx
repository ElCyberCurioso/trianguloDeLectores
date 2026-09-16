import type { FC } from 'hono/jsx';
import { Icon } from '../components/icons';
import { BACKUP_RETENTION_DAYS, type BackupListing } from '../../services/backup';
import { AdminPage, CsrfField, Flash } from './shared';

function formatSize(bytes: number): string {
  const kb = bytes / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(kb))} kB`;
}

/**
 * Las copias del sitio público.
 *
 * Es la misma pantalla que la de la biblioteca privada, pero en el panel del
 * sitio y sobre sus datos: son dos aplicaciones y cada una enseña lo suyo. Que
 * la copia exista no sirve de nada si no hay dónde verla ni forma de bajarla
 * sin abrir una terminal.
 */
export const AdminBackupsPage: FC<{
  backups: BackupListing[];
  csrfToken: string;
  flash?: { kind: 'ok' | 'error'; message: string } | null;
}> = ({ backups, csrfToken, flash }) => (
  <AdminPage title="Copias de seguridad">
    {flash ? <Flash kind={flash.kind} message={flash.message} /> : null}

    <p class="page-lead">
      Cada madrugada se guarda un volcado de las reseñas, los episodios, los comentarios, la cola de pendientes,
      las taxonomías, las recomendaciones y los ajustes. Se conservan {BACKUP_RETENTION_DAYS} días.
    </p>
    <p class="field__hint">
      No entran ni las cuentas —llevan los hash de contraseña, y la de administración se rehace con{' '}
      <code>npm run admin:create</code>— ni el registro de auditoría, que tiene su propia retención y se purga a
      propósito. Las portadas tampoco: son ficheros y ya viven en R2.
    </p>

    <form method="post" action="/admin/copias/ahora" class="editor__submit">
      <CsrfField token={csrfToken} />
      <button class="btn btn--ghost" type="submit">
        <Icon name="download" size={14} />
        <span>Hacer una copia ahora</span>
      </button>
    </form>

    {backups.length === 0 ? (
      <p class="empty">Todavía no hay ninguna copia. La primera se hará esta noche.</p>
    ) : (
      <ul class="backuplist">
        {backups.map((backup) => (
          <li class="backup">
            <span class="backup__day">{backup.day}</span>
            <span class="backup__size">{formatSize(backup.size)}</span>
            <a class="btn btn--ghost btn--sm" href={`/admin/copias/${backup.day}`} download>
              <Icon name="download" size={13} />
              <span>Descargar</span>
            </a>
          </li>
        ))}
      </ul>
    )}
  </AdminPage>
);
