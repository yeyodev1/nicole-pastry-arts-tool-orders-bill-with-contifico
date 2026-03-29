/**
 * send-to-sri.ts
 *
 * Envía al SRI todos los documentos Contifico que están PROCESSED
 * pero sin autorización. No espera firma — intenta enviar siempre
 * (Contifico puede estar firmado internamente aunque el flag diga false).
 *
 * Correr después de esperar ~8 min desde create-cf-invoices.ts
 * Luego correr verify:invoices para recoger autorizaciones.
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { models } from '../src/models/index';
import { ContificoService } from '../src/services/contifico.service';

dotenv.config();

const nicoleSvc = new ContificoService('nicole');
const sucreeSvc = new ContificoService('sucree');
function getSvc(s?: string) { return s === 'sucree' ? sucreeSvc : nicoleSvc; }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const mongoUri = process.env.MONGODB_URI ?? process.env.MONGO_URI ?? '';
  if (!mongoUri) throw new Error('MONGODB_URI no definido en .env');

  await mongoose.connect(mongoUri);
  console.log('✅ MongoDB conectado\n');

  const orders = await models.orders
    .find({
      invoiceStatus: 'PROCESSED',
      'invoiceInfo.id': { $exists: true, $ne: null },
      'invoiceInfo.autorizacion': { $in: [null, undefined, ''] },
      voidedAt: null,
    })
    .sort({ createdAt: 1 });

  if (orders.length === 0) {
    console.log('✅ No hay docs pendientes de enviar al SRI.');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`📤 Enviando ${orders.length} documentos al SRI...\n`);

  let sent = 0;
  let failed = 0;
  const CHUNK_SIZE = 10;

  for (let i = 0; i < orders.length; i += CHUNK_SIZE) {
    const chunk = orders.slice(i, i + CHUNK_SIZE);

    await Promise.all(chunk.map(async (order) => {
      const docId = (order as any).invoiceInfo?.id;
      const name = String(order.customerName ?? order._id).slice(0, 35).padEnd(35);
      const svc = getSvc((order as any).contificoSource);

      try {
        await svc.sendToSri(docId);
        await models.orders.findByIdAndUpdate(order._id, { invoiceSentToSriAt: new Date() });
        process.stdout.write(`  ✅ ${name} — ${docId}\n`);
        sent++;
      } catch (err: any) {
        process.stdout.write(`  ⚠️  ${name} — ${err?.message?.slice(0, 40) ?? 'error'}\n`);
        failed++;
      }
    }));

    if (i + CHUNK_SIZE < orders.length) await sleep(300);
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 Enviados: ${sent} ✅  Con error: ${failed} ⚠️`);
  console.log(`\n⏳ Ahora corre inmediatamente:`);
  console.log(`   pnpm verify:invoices\n`);
  console.log('═'.repeat(50));

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
