/**
 * watch-invoices.ts
 *
 * Hace polling automático del estado SRI cada 30s hasta que todas las
 * facturas estén autorizadas. Guarda la autorización en DB al momento de recibirla.
 *
 * Ejecutar:
 *   pnpm watch:invoices
 *
 * Ctrl+C para cancelar en cualquier momento.
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

// ─── Verificar una orden ──────────────────────────────────────────────────────
async function checkOrder(order: any): Promise<'AUTHORIZED' | 'WAITING' | 'NOT_SIGNED' | 'MISSING' | 'ERROR'> {
  const orderId = String(order._id);
  const docId: string = order.invoiceInfo?.id;
  const svc = getSvc(order.invoiceInfo?.source ?? order.contificoSource);

  try {
    const doc = await svc.getDocument(docId);

    if (doc?.autorizacion) {
      await models.orders.findByIdAndUpdate(orderId, {
        'invoiceInfo.autorizacion': doc.autorizacion,
        invoiceError: null
      });
      return 'AUTHORIZED';
    }

    if (!doc?.firmado) return 'NOT_SIGNED';

    // Firmado pero no autorizado aún — enviar si estado=C (firmado pero no enviado)
    if (doc.estado === 'C') {
      try {
        await svc.sendToSri(doc.id ?? docId);
        await models.orders.findByIdAndUpdate(orderId, { invoiceSentToSriAt: new Date() });
      } catch { /* non-fatal */ }
    }

    return 'WAITING';

  } catch (err: any) {
    const msg = String(err?.message ?? '');
    if (msg.includes('404') || msg.includes('not found')) return 'MISSING';
    return 'ERROR';
  }
}

// ─── Una ronda de verificación ────────────────────────────────────────────────
async function runRound(): Promise<{ authorized: number; waiting: number; notSigned: number; missing: number; total: number }> {
  const orders = await models.orders.find({
    invoiceStatus: 'PROCESSED',
    'invoiceInfo.id': { $exists: true, $ne: null },
    'invoiceInfo.autorizacion': { $in: [null, undefined, ''] },
    voidedAt: null
  }).sort({ createdAt: 1 });

  if (orders.length === 0) return { authorized: 0, waiting: 0, notSigned: 0, missing: 0, total: 0 };

  const CHUNK = 5; // más lento que verify para no saturar
  let authorized = 0, waiting = 0, notSigned = 0, missing = 0;

  for (let i = 0; i < orders.length; i += CHUNK) {
    const chunk = orders.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map(o => checkOrder(o)));

    for (let j = 0; j < results.length; j++) {
      const r = results[j];
      const name: string = chunk[j].customerName ?? chunk[j]._id;
      const shortId = String(chunk[j]._id).slice(-6);

      if (r === 'AUTHORIZED') {
        authorized++;
        console.log(`  ✅ AUTORIZADA  — ${name} (${shortId})`);
      } else if (r === 'MISSING') {
        missing++;
        console.log(`  ❌ DOC_MISSING — ${name} (${shortId})`);
      } else if (r === 'NOT_SIGNED') {
        notSigned++;
      }
      // WAITING → silencioso (demasiados para mostrar)
      if (r === 'WAITING') waiting++;
    }

    if (i + CHUNK < orders.length) await sleep(500);
  }

  return { authorized, waiting, notSigned, missing, total: orders.length };
}

// ─── Main loop ────────────────────────────────────────────────────────────────
async function main() {
  const mongoUri = process.env.MONGODB_URI ?? process.env.MONGO_URI ?? process.env.DB_URI ?? '';
  if (!mongoUri) throw new Error('MONGODB_URI / MONGO_URI / DB_URI no definido en .env');

  await mongoose.connect(mongoUri);
  console.log('✅ Conectado a MongoDB');
  console.log('👀 Iniciando watch — Ctrl+C para detener\n');

  const INTERVAL_MS = 30_000; // 30 segundos entre rondas
  let round = 0;
  let totalAuthorized = 0;

  while (true) {
    round++;
    const now = new Date().toLocaleTimeString('es-EC');
    console.log(`\n─── Ronda #${round} · ${now} ────────────────────────────────`);

    const { authorized, waiting, notSigned, missing, total } = await runRound();
    totalAuthorized += authorized;

    if (total === 0) {
      console.log(`✅ ¡Todas las facturas están autorizadas! Total acumulado: ${totalAuthorized}`);
      break;
    }

    console.log(`\n  Ronda ${round}: ✅ ${authorized} nuevas · ⏳ ${waiting} esperando · ⚠️  ${notSigned} sin firmar · ❌ ${missing} no encontradas`);
    console.log(`  Total acumulado autorizado: ${totalAuthorized}`);

    if (notSigned > 0) {
      console.log(`\n  ⚠️  ${notSigned} sin firmar → ejecuta pnpm regen:invoices en otra terminal para reprocesarlas`);
    }

    if (waiting === 0 && notSigned === 0 && missing === 0) {
      console.log('\n✅ ¡Todas procesadas!');
      break;
    }

    console.log(`\n  Próxima verificación en 30s...`);
    await sleep(INTERVAL_MS);
  }

  console.log('\n👋 Watch finalizado.');
  await mongoose.disconnect();
  process.exit(0);
}

// Ctrl+C graceful exit
process.on('SIGINT', async () => {
  console.log('\n\n⏹  Watch cancelado por el usuario.');
  await mongoose.disconnect().catch(() => {});
  process.exit(0);
});

main().catch(err => {
  console.error('💥 Error fatal:', err);
  process.exit(1);
});
