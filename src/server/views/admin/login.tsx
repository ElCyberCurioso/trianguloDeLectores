import type { FC } from 'hono/jsx';

export interface LoginPageProps {
  error?: string | null;
  email?: string;
  turnstileSiteKey: string | null;
  next?: string;
  siteName: string;
}

export const LoginPage: FC<LoginPageProps> = ({ error, email, turnstileSiteKey, next, siteName }) => (
  <div class="wrap login">
    <div class="login__card">
      <span class="login__logo" aria-hidden="true" />
      <h1 class="login__title visually-hidden">{siteName}</h1>
      <p class="login__subtitle">Acceso al panel de administración</p>

      {error ? (
        <p class="flash flash--error" role="alert">
          {error}
        </p>
      ) : null}

      <form method="post" action="/admin/login" class="login__form" autocomplete="on">
        {next ? <input type="hidden" name="next" value={next} /> : null}

        <div class="field">
          <label class="field__label" for="f-email">
            Email
          </label>
          <input
            id="f-email"
            class="input"
            type="email"
            name="email"
            value={email ?? ''}
            required
            maxlength={254}
            autocomplete="username"
            autofocus
          />
        </div>

        <div class="field">
          <label class="field__label" for="f-password">
            Contraseña
          </label>
          <input
            id="f-password"
            class="input"
            type="password"
            name="password"
            required
            minlength={8}
            maxlength={200}
            autocomplete="current-password"
          />
        </div>

        {turnstileSiteKey ? (
          <div class="cf-turnstile" data-sitekey={turnstileSiteKey} data-theme="auto" />
        ) : null}

        <button type="submit" class="btn btn--primary btn--block">
          Entrar
        </button>
      </form>
    </div>
  </div>
);
