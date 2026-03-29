import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { models } from '../src/models/index';
import { ContificoService } from '../src/services/contifico.service';
dotenv.config();

const nicoleSvc = new ContificoService('nicole');
const sucreeSvc = new ContificoService('sucree');

function getSvc(source?: string): ContificoService {
  return source === 'sucree' ? sucreeSvc : nicoleSvc;
}

type VerifyResult =
  | 'AUTHORIZED'
  | 'WAITING_SRI'
  | 'SENT_NOW'
  | 'NOT_SIGNED'
  | 'DOC_MISSING';

interface OrderResult {
  status: VerifyResult;
  customerName: string;
  orderId: string;
  extra?: string;
}

async function verifyOrder(order: any): Promise<OrderResult> {
  const orderId = String(order._id);
  const customerName: string = order.customerName ?? 'Sin nombre';
  const docId: string = order.invoiceInfo?.id;
  const source: string | undefined = order.invoiceInfo?.source ?? order.contificoSource;
  const svc = getSvc(source);

  let doc: any;
  try {
    doc = await svc.getDocument(docId);
  } catch (err: any) {
    const msg: string = err?.message ?? '';
    if (
      msg.toLowerCase().includes('404') ||
      msg.toLowerCase().includes('not found') ||
      msg.toLowerCase().includes('no encontrado')
    ) {
      return { status: 'DOC_MISSING', customerName, orderId };
    }
    throw err;
  }

  // 1. Already authorized
  if (doc.autorizacion) {
    await models.orders.findByIdAndUpdate(orderId, {
      'invoiceInfo.autorizacion': doc.autorizacion,
      invoiceError: null
    });
    return {
      status: 'AUTHORIZED',
      customerName,
      orderId,
      extra: `Auth: ${String(doc.autorizacion).slice(0, 10)}...`
    };
  }

  // 2. Signed checks
  if (doc.firmado) {
    // In SRI queue
    if (doc.estado === 'P' || doc.estado === 'E') {
      return {
        status: 'WAITING_SRI',
        customerName,
        orderId,
        extra: `estado: ${doc.estado}`
      };
    }

    // Signed but NOT sent yet → send now
    if (doc.estado === 'C') {
      try {
        await svc.sendToSri(doc.id ?? docId);
        await models.orders.findByIdAndUpdate(orderId, {
          invoiceSentToSriAt: new Date()
        });
      } catch (_) {
        // sendToSri failure is non-fatal; log and continue
      }
      return { status: 'SENT_NOW', customerName, orderId };
    }
  }

  // 3. Not signed yet
  return { status: 'NOT_SIGNED', customerName, orderId };
}

async function main() {
  const mongoUri = process.env.MONGODB_URI ?? process.env.MONGO_URI ?? '';
  if (!mongoUri) throw new Error('MONGODB_URI not set in .env');

  await mongoose.connect(mongoUri);
  console.log('✅ MongoDB connected\n');

  const orders = await models.orders
    .find({
      invoiceStatus: 'PROCESSED',
      'invoiceInfo.id': { $exists: true, $ne: null },
      'invoiceInfo.autorizacion': { $in: [null, undefined, ''] },
      voidedAt: null
    })
    .sort({ createdAt: 1 });

  if (orders.length === 0) {
    console.log('✅ No hay facturas pendientes de verificación.\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  console.log(`🔍 Verificando ${orders.length} factura(s) con doc Contifico...\n`);

  const CHUNK_SIZE = 10;
  const results: OrderResult[] = [];

  for (let i = 0; i < orders.length; i += CHUNK_SIZE) {
    const chunk = orders.slice(i, i + CHUNK_SIZE);
    const chunkResults = await Promise.all(chunk.map(verifyOrder));
    results.push(...chunkResults);
  }

  // Print per-order results
  for (const r of results) {
    switch (r.status) {
      case 'AUTHORIZED':
        console.log(`  ✅ [AUTHORIZED] ${r.customerName} (${r.orderId}) — ${r.extra}`);
        break;
      case 'WAITING_SRI':
        console.log(`  ⏳ [WAITING_SRI] ${r.customerName} (${r.orderId}) — ${r.extra}`);
        break;
      case 'SENT_NOW':
        console.log(`  📤 [SENT_NOW] ${r.customerName} (${r.orderId}) — firmado, enviado al SRI`);
        break;
      case 'NOT_SIGNED':
        console.log(`  ⚠️  [NOT_SIGNED] ${r.customerName} (${r.orderId}) — Contifico aún no firmó`);
        break;
      case 'DOC_MISSING':
        console.log(`  ❌ [DOC_MISSING] ${r.customerName} (${r.orderId}) — doc no existe en Contifico`);
        break;
    }
  }

  const counts = {
    AUTHORIZED: results.filter(r => r.status === 'AUTHORIZED').length,
    SENT_NOW: results.filter(r => r.status === 'SENT_NOW').length,
    WAITING_SRI: results.filter(r => r.status === 'WAITING_SRI').length,
    NOT_SIGNED: results.filter(r => r.status === 'NOT_SIGNED').length,
    DOC_MISSING: results.filter(r => r.status === 'DOC_MISSING').length
  };

  console.log('\n📊 RESULTADO VERIFICACIÓN');
  console.log(`  ✅ Autorizadas y guardadas:     ${counts.AUTHORIZED}`);
  console.log(`  📤 Enviadas al SRI ahora:       ${counts.SENT_NOW}`);
  console.log(`  ⏳ En cola del SRI (esperando): ${counts.WAITING_SRI}`);
  console.log(`  ⚠️  No firmadas aún:            ${counts.NOT_SIGNED}`);
  console.log(`  ❌ Doc no encontrado:           ${counts.DOC_MISSING}`);
  console.log('');

  const total = counts.AUTHORIZED + counts.SENT_NOW + counts.WAITING_SRI + counts.NOT_SIGNED + counts.DOC_MISSING;

  if (total === 0) {
    console.log('✅ Todas las facturas procesadas están al día.');
  } else {
    if (counts.AUTHORIZED > 0) {
      console.log(`✅ ${counts.AUTHORIZED} factura(s) autorizada(s). Número de autorización guardado en DB.`);
    }
    if (counts.WAITING_SRI > 0) {
      console.log(`⏳ ${counts.WAITING_SRI} factura(s) en cola. Vuelve a ejecutar en 5 min.`);
    }
    if (counts.NOT_SIGNED > 0) {
      console.log(`⚠️  ${counts.NOT_SIGNED} factura(s) sin firmar — ejecuta \`regenerate-invoices.ts\` para reprocesarlas.`);
    }
  }

  await mongoose.disconnect();
  process.exit(0);
}

main().catch(err => {
  console.error('❌ Error fatal:', err);
  process.exit(1);
});
