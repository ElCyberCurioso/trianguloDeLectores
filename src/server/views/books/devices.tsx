import type { FC } from 'hono/jsx';
import type { DeviceRecord } from '../../../db/repos/devices';
import { Icon } from '../components/icons';
import { CsrfField, Flash } from '../components/ui';

/** Fecha corta y hora, que es lo que hace falta para reconocer un teléfono. */
function fecha(ms: number): string {
  return new Date(ms).toLocaleString('es-ES', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

type Estado = { texto: string; clase: string };

function estadoDe(device: DeviceRecord, ahora: number): Estado {
  if (device.revokedAt) return { texto: `Revocado el ${fecha(device.revokedAt)}`, clase: 'device--off' };
  if (device.expiresAt <= ahora) return { texto: `Caducado el ${fecha(device.expiresAt)}`, clase: 'device--off' };
  return { texto: `Caduca el ${fecha(device.expiresAt)}`, clase: 'device--on' };
}

/**
 * Los teléfonos emparejados con la biblioteca.
 *
 * La credencial del móvil dura 90 días y se renueva sola mientras se use, así
 * que un teléfono perdido seguiría entrando hasta tres meses. Había forma de
 * revocarla —`DELETE /api/movil/sesion`—, pero la llamaba el propio teléfono:
 * justo el que ya no se tiene. Esta pantalla es la que faltaba.
 */
export const DevicesPage: FC<{
  devices: DeviceRecord[];
  ahora: number;
  csrfToken: string | null;
  flash?: { kind: 'ok' | 'error'; message: string } | null;
}> = ({ devices, ahora, csrfToken, flash }) => {
  const vivos = devices.filter((d) => !d.revokedAt && d.expiresAt > ahora);

  return (
    <>
      <section class="section-rule">
        <h1 class="page-title">Dispositivos</h1>
        <p class="page-lead">
          Los teléfonos emparejados con esta biblioteca. La credencial dura 90 días y se renueva mientras se use;
          revocarla obliga a volver a emparejar desde la aplicación.
        </p>
      </section>

      {flash ? <Flash kind={flash.kind} message={flash.message} /> : null}

      {devices.length === 0 ? (
        <p class="empty">Ningún dispositivo emparejado todavía.</p>
      ) : (
        <ul class="devicelist">
          {devices.map((device) => {
            const estado = estadoDe(device, ahora);
            const activo = !device.revokedAt && device.expiresAt > ahora;
            return (
              <li class={`device ${estado.clase}`}>
                <div class="device__body">
                  <p class="device__name">{device.deviceName}</p>
                  <p class="device__meta">
                    Último uso: {fecha(device.lastSeenAt)} · Emparejado el {fecha(device.createdAt)}
                  </p>
                  <p class="device__meta">{estado.texto}</p>
                </div>
                {/* El `data-confirm` va en el formulario, que es donde lo busca
                    la isla (`initConfirmForms`), no en el botón. */}
                {activo ? (
                  <form
                    method="post"
                    action={`/dispositivos/${device.id}/revocar`}
                    data-confirm="¿Revocar este dispositivo? Habrá que volver a emparejarlo."
                  >
                    <CsrfField token={csrfToken ?? ''} />
                    <button class="btn btn--ghost btn--sm" type="submit">
                      <Icon name="lock" size={13} />
                      <span>Revocar</span>
                    </button>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {vivos.length > 1 ? (
        <form
          method="post"
          action="/dispositivos/revocar-todos"
          class="library__actions"
          data-confirm="¿Revocar todos los dispositivos? Habrá que emparejarlos de nuevo."
        >
          <CsrfField token={csrfToken ?? ''} />
          <button class="btn btn--ghost" type="submit">
            <Icon name="lock" size={14} />
            <span>Revocar todos</span>
          </button>
        </form>
      ) : null}
    </>
  );
};
