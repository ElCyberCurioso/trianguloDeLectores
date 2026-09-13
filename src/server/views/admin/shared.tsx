/**
 * Piezas del panel.
 *
 * `CsrfField`, `Field` y `Flash` viven ahora en `components/ui.tsx`: los usa
 * también el formulario de pendientes de la página pública, y un widget de
 * formulario compartido no puede vivir sólo en el panel. Se re-exportan para no
 * tocar los veinte sitios que ya los importan de aquí.
 */
import type { FC, PropsWithChildren } from 'hono/jsx';

export { CsrfField, Field, Flash } from '../components/ui';


export const AdminPage: FC<PropsWithChildren<{ title: string; actions?: unknown }>> = ({
  title,
  actions,
  children,
}) => (
  <div class="wrap admin">
    <div class="admin__head">
      <h1 class="admin__title">{title}</h1>
      {actions ? <div class="admin__actions">{actions}</div> : null}
    </div>
    {children}
  </div>
);
