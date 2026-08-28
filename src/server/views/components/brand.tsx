import type { FC } from 'hono/jsx';

/**
 * Marca «1C · Tres reglas».
 *
 * Tres reglas horizontales de anchura decreciente —100 %, 66 % y 33 %—, la
 * tercera en acento. Insinúan el triángulo sin dibujarlo y están hechas del
 * mismo material que la página: la regla tipográfica.
 *
 * Proporciones fijas del brand kit: grosor = 1/5 del alto del bloque y hueco
 * entre reglas = 0,6 × grosor. Con grosor 5 y hueco 3 el bloque mide 21 de alto
 * por 100 de ancho, que es el `viewBox` de abajo. No se centra, no lleva puntas
 * redondeadas, no va entera en rojo y no se invierte el orden.
 */

const ANCHOS = [100, 66, 33];
const GROSOR = 5;
const HUECO = 3;

export interface MarkProps {
  /** Ancho del isotipo en píxeles. El alto sale de la proporción. */
  width?: number;
  class?: string;
  /**
   * Cuál de las tres reglas va en acento. Por omisión la tercera, que es la
   * marca. Cambiarlo sólo tiene sentido en los avatares de los lectores, donde
   * la posición del rojo identifica a cada uno.
   */
  accentIndex?: 0 | 1 | 2;
}

export const Mark: FC<MarkProps> = ({ width = 40, class: className, accentIndex = 2 }) => (
  <svg
    class={`mark${className ? ` ${className}` : ''}`}
    width={width}
    height={Math.round((width * 21) / 100)}
    viewBox="0 0 100 21"
    fill="none"
    aria-hidden="true"
    focusable="false"
  >
    {ANCHOS.map((ancho, i) => (
      <rect
        x="0"
        y={i * (GROSOR + HUECO)}
        width={ancho}
        height={GROSOR}
        class={i === accentIndex ? 'mark__rule mark__rule--accent' : 'mark__rule'}
      />
    ))}
  </svg>
);

/** Lockup horizontal: el de la cabecera. Isotipo y nombre en una línea. */
export const BrandLockup: FC<{ siteName: string; markWidth?: number }> = ({ siteName, markWidth = 40 }) => (
  <>
    <Mark width={markWidth} />
    <span class="brand__name">{siteName}</span>
  </>
);

/**
 * Lockup vertical: el principal. El isotipo sobre el nombre en dos líneas.
 * Lleva `role="img"` y su nombre accesible, porque sustituye a un logotipo.
 */
export const BrandStack: FC<{ siteName: string; markWidth?: number; class?: string }> = ({
  siteName,
  markWidth = 132,
  class: className,
}) => (
  <span class={`brand-stack${className ? ` ${className}` : ''}`} role="img" aria-label={siteName}>
    <Mark width={markWidth} />
    <span class="brand-stack__name" aria-hidden="true">
      Triángulo
      <br />
      de Lectores
    </span>
  </span>
);
