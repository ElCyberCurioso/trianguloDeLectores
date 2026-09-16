/**
 * Los campos que sólo aplican a algunos tipos de contenido.
 *
 * «Temporadas» y «Episodios» no significan nada en una película ni en un libro;
 * «Volúmenes» sólo lo significa en un cómic o un manga; y el año de una
 * película es un año y no un periodo. Pedirlo todo a todo llenaba la ficha de
 * casillas que no aplican.
 *
 * Cada elemento declara los tipos en los que sale —`data-types-only`— en vez de
 * haber aquí una tabla de grupos: la lista sale de las constantes del dominio
 * al pintar, así que no hay una segunda copia en el navegador que se quede
 * atrás cuando cambien. El servidor ya los pinta tapados según el tipo que trae
 * la ficha; esto sólo los destapa y los vuelve a tapar al cambiar el
 * desplegable, para no recargar la página por un campo.
 *
 * Sin JavaScript se quedan como los pintó el servidor: el formulario se envía
 * igual y el único coste es ver un campo de más.
 */

/** Los tipos declarados en un `data-*`, que viajan separados por espacios. */
function tipos(el: HTMLElement, attr: string): string[] {
  return (el.getAttribute(attr) ?? '').split(' ').filter(Boolean);
}

export function initTypeFields(): void {
  document.querySelectorAll<HTMLSelectElement>('[data-content-type]').forEach((select) => {
    const scope = select.closest('form');
    if (!scope) return;

    const campos = [...scope.querySelectorAll<HTMLElement>('[data-types-only]')];
    if (campos.length === 0) return;

    const year = scope.querySelector<HTMLInputElement>('[data-placeholder-types]');

    const aplica = (el: HTMLElement, attr = 'data-types-only') => tipos(el, attr).includes(select.value);

    const pintar = (inicial: boolean) => {
      campos.forEach((campo) => {
        // En la primera pasada no se toca lo que ya pintó el servidor: sabe el
        // tipo de la ficha y acierta. La excepción son los bloques que no
        // sirven de nada sin JavaScript —un buscador que no busca—, que nacen
        // tapados y sólo los destapa esto.
        if (inicial && !campo.hasAttribute('data-js-only')) return;

        const sale = aplica(campo);
        // Un campo con error se queda a la vista aunque no aplique: si no, el
        // mensaje que explica por qué no se guardó la ficha desaparecería con
        // él y no habría forma de saber qué arreglar.
        campo.hidden = !sale && !campo.hasAttribute('data-keep-visible');

        // Lo que deja de verse dejaría de poder corregirse y se enviaría igual:
        // un número de temporadas pegado a una película. Se borra sólo al
        // cambiar de tipo a mano, nunca al abrir la ficha, que es donde ese
        // valor puede ser el que ya estaba guardado.
        if (!sale && !inicial) {
          campo.querySelectorAll<HTMLInputElement>('input').forEach((input) => {
            input.value = '';
          });
        }
      });

      if (year && !inicial) {
        const periodo = aplica(year, 'data-placeholder-types');
        year.placeholder = (periodo ? year.dataset.placeholderOn : year.dataset.placeholderOff) ?? '';
      }
    };

    pintar(true);

    let anterior = select.value;
    select.addEventListener('change', () => {
      if (select.value === anterior) return;
      anterior = select.value;
      pintar(false);
    });
  });
}
