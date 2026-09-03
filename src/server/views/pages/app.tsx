import type { FC } from 'hono/jsx';
import type { ApkManifest } from '../../lib/apk';
import { formatApkSize } from '../../lib/apk';

/**
 * Página de descarga de la aplicación Android.
 *
 * Se publica en el sitio público —no en el subdominio privado— porque hay que
 * poder llegar a ella desde un teléfono recién estrenado, antes de tener con
 * qué entrar en ningún sitio. El APK no es secreto: lo que está detrás del
 * acceso es la biblioteca, y la aplicación no sirve de nada sin credenciales.
 *
 * No hay Google Play por medio, así que Android pedirá permiso para instalar
 * desde el navegador. Eso se explica aquí y no se deja para que lo descubra
 * quien pulsa: un aviso del sistema que nadie ha anticipado parece un fallo.
 */
export const AppPage: FC<{ siteName: string; booksUrl: string; manifest: ApkManifest | null }> = ({
  siteName,
  booksUrl,
  manifest,
}) => (
  <div class="wrap prose prose--page">
    <h1>Aplicación para Android</h1>
    <p>
      Un lector de PDF para el teléfono. Funciona solo, con los documentos que ya tengas en el
      móvil, y además se conecta con la biblioteca privada de {siteName}: los libros que hay
      subidos ahí se descargan, se leen sin conexión y la lectura continúa donde la dejaste,
      da igual en cuál de los dos sitios estuvieras.
    </p>

    {manifest ? (
      <>
        <p>
          <a class="btn btn--primary" href="/aplicacion/descargar" rel="nofollow">
            Descargar la versión {manifest.version}
          </a>
        </p>
        <dl class="specs">
          <div class="specs__row">
            <dt>Versión</dt>
            <dd>
              {manifest.version} (código {manifest.versionCode})
            </dd>
          </div>
          <div class="specs__row">
            <dt>Tamaño</dt>
            <dd>{formatApkSize(manifest.sizeBytes)}</dd>
          </div>
          <div class="specs__row">
            <dt>Publicada</dt>
            <dd>{manifest.publishedAt.slice(0, 10)}</dd>
          </div>
          <div class="specs__row">
            <dt>Android mínimo</dt>
            <dd>{androidName(manifest.minSdk)}</dd>
          </div>
          <div class="specs__row">
            <dt>SHA-256</dt>
            <dd>
              <code class="hash">{manifest.sha256}</code>
            </dd>
          </div>
        </dl>
        {manifest.notes ? <p>{manifest.notes}</p> : null}
      </>
    ) : (
      <p>
        Todavía no hay ninguna versión publicada en este entorno. Vuelve dentro de un rato.
      </p>
    )}

    <h2>Qué hace</h2>
    <ul>
      <li>Abre cualquier PDF del teléfono, de la tarjeta o de la nube, sin subirlo a ninguna parte.</li>
      <li>Guarda por dónde vas en cada documento y vuelve a esa página al abrirlo.</li>
      <li>Subrayados de cuatro colores y notas sueltas, con su lista por documento.</li>
      <li>Páginas marcadas, para volver a un sitio concreto sin buscarlo.</li>
      <li>Lectura a oscuras, con el mismo tema que el sitio.</li>
    </ul>

    <h2>Con la biblioteca privada</h2>
    <p>
      La aplicación se empareja con <a href={booksUrl}>{hostOf(booksUrl)}</a> escribiendo el
      mismo email y la misma contraseña que usas en el navegador. A partir de ahí, el teléfono
      guarda su propia credencial —no la contraseña— y se sincronizan la posición de lectura,
      los subrayados, las notas y las páginas marcadas en los dos sentidos.
    </p>
    <p>
      Si dejas de usar un teléfono, o lo pierdes, esa credencial se puede retirar por separado
      sin tocar la contraseña ni cerrar la sesión del navegador.
    </p>

    <h2>Cómo se instala</h2>
    <p>
      No está en Google Play, así que al abrir el archivo descargado Android preguntará si
      permites instalar aplicaciones desde el navegador. Es un permiso por aplicación y se
      puede quitar después de instalar. Si quieres comprobar que el archivo es el mismo que se
      publicó aquí, la suma SHA-256 está arriba.
    </p>

    <h2>Qué datos salen del teléfono</h2>
    <p>
      Sólo lo que se sincroniza con la biblioteca privada, y sólo hacia ella. Los PDF que abras
      desde el propio teléfono se quedan en el teléfono: la aplicación no los sube, no los
      copia y no manda nada a ningún tercero. No lleva analítica ni publicidad.
    </p>
  </div>
);

/** El número de API no le dice nada a nadie: se traduce a la versión de siempre. */
function androidName(minSdk: number): string {
  const names: Record<number, string> = { 26: '8.0 (Oreo)', 27: '8.1', 28: '9 (Pie)', 29: '10', 30: '11', 31: '12' };
  return names[minSdk] ? `Android ${names[minSdk]} o superior` : `API ${minSdk} o superior`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
