import type { FC } from 'hono/jsx';

export const AboutPage: FC<{ siteName: string }> = ({ siteName }) => (
  <div class="wrap prose prose--page">
    <h1>Sobre {siteName}</h1>
    <p>
      {siteName} es un catálogo personal de reseñas de libros, novelas, películas, series,
      anime, cómics, manga y videojuegos. Cada ficha reúne los datos básicos de la obra, dónde
      encontrarla y una crítica honesta puntuada de 0 a 10.
    </p>
    <h2>Cómo se puntúa</h2>
    <ul>
      <li><strong>5</strong> — imprescindible.</li>
      <li><strong>4</strong> — muy recomendable, con matices.</li>
      <li><strong>3</strong> — correcta, disfrutable.</li>
      <li><strong>2</strong> — floja, sólo para completistas.</li>
      <li><strong>1 o menos</strong> — no compensa el tiempo.</li>
    </ul>
    <h2>Spoilers</h2>
    <p>
      Las reseñas que destripan la trama se marcan con un aviso. Dentro del texto, los pasajes
      sensibles quedan ocultos hasta que pulsas <em>Mostrar spoiler</em>.
    </p>
  </div>
);

export const PrivacyPage: FC<{ siteName: string }> = ({ siteName }) => (
  <div class="wrap prose prose--page">
    <h1>Política de privacidad</h1>
    <p>
      {siteName} aplica minimización de datos: sólo se trata lo imprescindible para publicar
      comentarios y moderarlos.
    </p>
    <h2>Qué datos se tratan</h2>
    <ul>
      <li><strong>Alias</strong> que escribes al comentar. Puede ser un seudónimo.</li>
      <li><strong>Contenido</strong> del comentario.</li>
      <li>
        <strong>Huella técnica</strong>: la dirección IP y el navegador no se almacenan en claro.
        Se guarda únicamente un valor HMAC irreversible, usado para limitar el spam y evitar
        reportes duplicados.
      </li>
      <li>
        <strong>Cookies funcionales</strong>: una cookie de sesión para el panel de administración
        y un identificador anónimo y aleatorio para no permitir reportar dos veces el mismo
        comentario. No hay cookies publicitarias ni de seguimiento entre sitios.
      </li>
    </ul>
    <h2>Base legal</h2>
    <p>
      Interés legítimo en mantener el sitio libre de spam y abuso (art. 6.1.f RGPD) y ejecución
      del servicio que solicitas al publicar un comentario.
    </p>
    <h2>Conservación</h2>
    <p>
      Los comentarios se conservan mientras la reseña siga publicada. El registro de auditoría se
      purga automáticamente según el periodo configurado (por defecto, 365 días).
    </p>
    <h2>Encargados de tratamiento</h2>
    <p>
      El sitio se aloja íntegramente en la infraestructura de Cloudflare (Workers, D1, R2, KV),
      que actúa como encargada del tratamiento con centros de datos en la UE cuando así se
      configura la jurisdicción de datos.
    </p>
    <h2>Tus derechos</h2>
    <p>
      Puedes solicitar el acceso, la rectificación o la supresión de tus comentarios escribiendo a
      la dirección de contacto del sitio. Al no recogerse identificadores personales, indica el
      enlace del comentario para poder localizarlo.
    </p>
  </div>
);

export const CookiesPage: FC = () => (
  <div class="wrap prose prose--page">
    <h1>Política de cookies</h1>
    <p>Este sitio no usa cookies publicitarias, de analítica invasiva ni de seguimiento entre sitios.</p>
    <table>
      <thead>
        <tr>
          <th scope="col">Cookie</th>
          <th scope="col">Finalidad</th>
          <th scope="col">Duración</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td><code>tdl_session</code></td>
          <td>Sesión del panel de administración. Sólo se emite tras iniciar sesión.</td>
          <td>12 horas</td>
        </tr>
        <tr>
          <td><code>tdl_rid</code></td>
          <td>Identificador anónimo y aleatorio para impedir reportes duplicados.</td>
          <td>180 días</td>
        </tr>
        <tr>
          <td><code>cf_clearance</code> / Turnstile</td>
          <td>Verificación anti-bot de Cloudflare al enviar formularios.</td>
          <td>Sesión</td>
        </tr>
      </tbody>
    </table>
    <p>
      El tema claro/oscuro se guarda en <code>localStorage</code>, no en una cookie, y nunca se
      envía al servidor.
    </p>
  </div>
);

export const ErrorPage: FC<{ status: number; title: string; message: string }> = ({ status, title, message }) => (
  <div class="wrap error-page">
    <p class="error-page__code">{status}</p>
    <h1 class="error-page__title">{title}</h1>
    <p class="error-page__message">{message}</p>
    <a class="btn btn--primary" href="/">
      Volver al catálogo
    </a>
  </div>
);
