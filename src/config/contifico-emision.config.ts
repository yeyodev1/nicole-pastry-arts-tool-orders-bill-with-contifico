/**
 * Configuración del punto de emisión de facturas en Contífico.
 *
 * Contexto (verificado contra la API el 04/09/2026, cuenta LA FINESTRA S.A.S. — RUC 0993375793001):
 * la cuenta tiene UN SOLO establecimiento (001), cuya dirección en el SRI es
 * "GUAYAQUIL / CALLE PRIMERA Y CALLE SEGUNDA / MAPASINGUE OESTE" — el CDP.
 * No existe ningún establecimiento ni punto de emisión de "Mall del Sol".
 *
 * Puntos de emisión de la cuenta:
 *   001-001 → Matriz / CDP  ← el que usa esta integración (principal)
 *   001-002 → Caja Dulcería
 *   001-003 → Caja Heladería
 *   001-004 → Caja Casa Mía
 *   001-005 → C.C. San Marino
 *   999-999 → POS "API" (no electrónico)
 *
 * Toda factura emitida por este sistema debe salir en 001-001 (CDP principal).
 */

/** Establecimiento SRI (3 dígitos). */
export const CONTIFICO_ESTABLECIMIENTO = (process.env.CONTIFICO_ESTABLECIMIENTO || "001").padStart(3, "0");

/** Punto de emisión SRI (3 dígitos). 001 = Matriz / CDP. */
export const CONTIFICO_PUNTO_EMISION = (process.env.CONTIFICO_PUNTO_EMISION || "001").padStart(3, "0");

/** Serie del documento, ej. "001-001". */
export const CONTIFICO_SERIE = `${CONTIFICO_ESTABLECIMIENTO}-${CONTIFICO_PUNTO_EMISION}`;

/**
 * Piso duro del secuencial: 1 000 000.
 *
 * Hasta el 04/09/2026 el número se sorteaba con `Math.random()` dentro del rango
 * 100000–999999, así que la serie 001-001 quedó salpicada de números sin orden a
 * lo largo de TODO ese rango (muestra real de 4 días: 23 facturas entre 116 943 y
 * 975 842, sin secuencia). No hay forma barata de conocer el máximo histórico
 * exacto —la API sólo filtra por fecha de emisión— y adivinarlo arriesga emitir
 * un secuencial duplicado ante el SRI.
 *
 * Arrancar en 1 000 000 resuelve el problema sin tener que reconstruir el pasado:
 * queda por encima de cualquier número que el sorteo pudo haber generado, así que
 * la colisión es imposible por construcción. Deja un hueco en la serie, que el SRI
 * permite; lo que no permite es un número repetido.
 */
export const CONTIFICO_SECUENCIAL_MINIMO = Number(process.env.CONTIFICO_SECUENCIAL_MINIMO || 1_000_000);

/** Arma el número completo del documento, ej. "001-001-001000001". */
export function buildDocumentNumber(sequential: number): string {
  return `${CONTIFICO_SERIE}-${String(sequential).padStart(9, "0")}`;
}
