import type { FC } from 'hono/jsx';
import { Icon } from '../components/icons';
import { BACKUP_RETENTION_DAYS } from '../../services/backup';

function formatSize(bytes: number): string {
  const kb = bytes / 1024;
  return kb >= 1024 ? `${(kb / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(kb))} kB`;
}

export const BackupsPage: FC<{
  backups: { key: string; day: string; size: number }[];
  csrfToken: string | null;
}> = ({ backups, csrfToken }) => (
  <>
    <section class="section-rule">
      <h1 class="page-title">Copias de seguridad</h1>
      <p class="page-lead">
        Cada madrugada se guarda un volcado del catálogo, las fichas de los PDF, el progreso de lectura y las
        anotaciones. Se conservan {BACKUP_RETENTION_DAYS} días. Los ficheros PDF no entran: ya están en R2.
      </p>
    </section>

    <form method="post" action="/copias/ahora" class="library__actions">
      <input type="hidden" name="_csrf" value={csrfToken ?? ''} />
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
            <a class="btn btn--ghost btn--sm" href={`/copias/${backup.day}`} download>
              <Icon name="download" size={13} />
              <span>Descargar</span>
            </a>
          </li>
        ))}
      </ul>
    )}
  </>
);
