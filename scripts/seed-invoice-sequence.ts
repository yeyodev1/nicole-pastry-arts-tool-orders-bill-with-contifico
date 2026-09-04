/**
 * Siembra el contador de secuenciales de factura con el último número realmente
 * emitido en Contífico para la serie configurada (por defecto 001-001 = CDP).
 *
 * Correr una vez antes de desplegar el cambio de numeración:
 *   pnpm seed:invoice-sequence
 *
 * Es idempotente: vuelve a leer Contífico y deja el contador en el máximo real.
 */
import * as dotenv from "dotenv";
dotenv.config();

import dbConnect from "../src/config/mongo";
import { InvoiceSequenceModel } from "../src/models/invoice-sequence.model";
import { ContificoService } from "../src/services/contifico.service";
import { CONTIFICO_SERIE } from "../src/config/contifico-emision.config";

async function main() {
  await dbConnect();

  const service = new ContificoService("nicole");
  const daysBack = Number(process.argv[2] || 7);

  console.log(`🔎 Buscando el último secuencial de la serie ${CONTIFICO_SERIE} en Contífico (${daysBack} días)...`);
  const last = await service.fetchLastSequentialFromContifico(CONTIFICO_SERIE, daysBack);

  await InvoiceSequenceModel.updateOne(
    { source: "nicole", serie: CONTIFICO_SERIE },
    {
      $set: { lastSequential: last },
      $setOnInsert: { source: "nicole", serie: CONTIFICO_SERIE },
    },
    { upsert: true }
  );

  console.log(`✅ Contador de ${CONTIFICO_SERIE} listo en ${last}. La próxima factura será ${CONTIFICO_SERIE}-${String(last + 1).padStart(9, "0")}.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Error sembrando el contador:", err);
  process.exit(1);
});
