/**
 * Configuración del cobro en Contífico.
 *
 * Todas las transferencias entran a la misma cuenta: Banco Guayaquil.
 *
 * Antes el vendedor escribía el nombre del banco a mano y el backend intentaba
 * empatarlo contra el catálogo de Contífico. Eso fallaba en silencio: la cuenta
 * está registrada en Contífico como "Banco Guayquil" —sin la "a"— así que
 * "Banco Guayaquil" nunca empataba y el cobro caía al primer banco de la lista
 * por descarte. Acertaba de casualidad, porque ese primer banco resulta ser el
 * correcto; con que Contífico cambiara el orden, los cobros se habrían ido a
 * otra cuenta sin que nadie lo notara.
 *
 * Por eso se fija el ID y no el nombre.
 *
 * Cuentas de la empresa (consultadas en /banco/cuenta/ el 05/09/2026):
 *   RYWb4RPQcx81eZ1m → "Banco Guayquil"       nº 32039200    ← la que se usa
 *   lwKe5QQMI1lGe31R → "Banco Bolivariano"    nº 0935044393
 *   wy7aANAJs5RWbgZY → "Banco Pichincha"      nº 2100312631
 *   5gQbWLDDt84Bd6w2 → "Banco Internacional"  nº 1000657525
 *   NO8bYW1vIX9xe7j4 → "BANCO PACIFICO"       nº 0008776628
 */

/** Cuenta bancaria a la que se registran todas las transferencias (TRA). */
export const CONTIFICO_CUENTA_BANCARIA_TRA =
  process.env.CONTIFICO_CUENTA_BANCARIA_TRA || "RYWb4RPQcx81eZ1m";

/** Nombre para mostrar. Ojo: en Contífico está escrito "Banco Guayquil". */
export const CONTIFICO_BANCO_TRA_NOMBRE = "Banco Guayaquil";
