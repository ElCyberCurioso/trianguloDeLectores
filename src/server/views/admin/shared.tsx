import type { FC, PropsWithChildren } from 'hono/jsx';

export const CsrfField: FC<{ token: string }> = ({ token }) => (
  <input type="hidden" name="_csrf" value={token} />
);

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

export const Field: FC<
  PropsWithChildren<{ label: string; name: string; hint?: string; error?: string; required?: boolean }>
> = ({ label, name, hint, error, required, children }) => (
  <div class={`field${error ? ' field--error' : ''}`}>
    <label class="field__label" for={`f-${name}`}>
      {label}
      {required ? <span class="field__req" aria-hidden="true"> *</span> : null}
    </label>
    {children}
    {hint ? <p class="field__hint">{hint}</p> : null}
    {error ? (
      <p class="field__error" role="alert">
        {error}
      </p>
    ) : null}
  </div>
);

export const Flash: FC<{ kind: 'ok' | 'error'; message: string }> = ({ kind, message }) => (
  <p class={`flash flash--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
    {message}
  </p>
);
