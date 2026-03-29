/**
 * create-cf-invoices.ts
 *
 * Crea documentos nuevos en Contifico usando Consumidor Final
 * para todas las órdenes pendientes sin autorización SRI.
 *
 * NO espera firma ni envía al SRI — solo crea el documento.
 * Después de correr este script, espera ~5-10 min y corre:
 *   pnpm send:sri
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

const CF = {
  businessName: 'consumidor final',
  ruc: '9999999999',
  email: 'noname@noname.com',
  address: 'sin direccion',
};

async function main() {
  const mongoUri = process.env.MONGODB_URI ?? process.env.MONGO_URI ?? '';
  if (!mongoUri) throw new Error('MONGODB_URI no definido en .env');

  await mongoose.connect(mongoUri);
  console.log('✅ MongoDB conectado\n');

  const orders = await models.orders
    .find({
      invoiceNeeded: true,
      voidedAt: null,
      $or: [
        { invoiceStatus: { $in: ['PENDING', 'ERROR', null, undefined] } },
        { invoiceStatus: 'PROCESSED', 'invoiceInfo.autorizacion': { $in: [null, undefined, ''] } },
      ],
    })
    .sort({ createdAt: 1 });

  if (orders.length === 0) {
    console.log('✅ No hay órdenes pendientes.');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`📋 ${orders.length} órdenes pendientes — creando docs CF...\n`);

  let ok = 0;
  let errors = 0;

  for (let i = 0; i < orders.length; i++) {
    const order = orders[i];
    const name = String(order.customerName ?? order._id).slice(0, 40).padEnd(40);
    process.stdout.write(`  [${i + 1}/${orders.length}] ${name} — `);

    // Reset estado para que quede limpio
    await models.orders.findByIdAndUpdate(order._id, {
      invoiceStatus: 'PENDING',
      invoiceInfo: null,
      invoiceError: null,
      invoiceSentToSriAt: null,
    });

    const svc = getSvc((order as any).contificoSource);
    const orderForCF = { ...order.toObject(), invoiceData: CF };
    const resp = await svc.createInvoice(orderForCF);

    if (!resp || resp?.error) {
      const msg = String(resp?.error?.mensaje ?? resp?.error ?? 'error').slice(0, 80);
      await models.orders.findByIdAndUpdate(order._id, { invoiceStatus: 'ERROR', invoiceError: msg });
      console.log(`❌ ${msg}`);
      errors++;
    } else {
      await models.orders.findByIdAndUpdate(order._id, {
        invoiceStatus: 'PROCESSED',
        invoiceInfo: resp,
        invoiceError: null,
      });
      console.log(`✅ ${resp.id}`);
      ok++;
    }

    if (i < orders.length - 1) await sleep(2000); // 2s entre cada uno
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`📊 Documentos creados: ${ok} ✅  Errores: ${errors} ❌`);
  console.log(`\n⏳ Ahora espera ~8 min para que Contifico firme, luego corre:`);
  console.log(`   pnpm send:sri\n`);
  console.log('═'.repeat(50));

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => { console.error('💥', err); process.exit(1); });
