/**
 * authorize-consumidor-final.ts
 *
 * Contifico firma en ciclos automáticos (no inmediatamente).
 * Por eso el script se divide en 3 fases:
 *
 *  FASE 1 — Crear todos los documentos en Contifico (consumidor final), uno por uno
 *  FASE 2 — Esperar el ciclo de firma de Contifico (hasta 15 min, polling cada 30s)
 *  FASE 3 — Enviar firmados al SRI + polling de autorización
 *
 * Ejecutar:  pnpm auth:consumidor
 * Ctrl+C para pausar; al relanzar continúa desde los pendientes.
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { models } from '../src/models/index';
import { ContificoService } from '../src/services/contifico.service';

dotenv.config();

// ─── Límite opcional: --limit N ──────────────────────────────────────────────
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg !== -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

// ─── Orden específica: --order ID ────────────────────────────────────────────
const orderArg = process.argv.indexOf('--order');
const SINGLE_ORDER_ID = orderArg !== -1 ? process.argv[orderArg + 1] : null;

const nicoleSvc = new ContificoService('nicole');
const sucreeSvc = new ContificoService('sucree');
function getSvc(s?: string) { return s === 'sucree' ? sucreeSvc : nicoleSvc; }
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }
function extractErr(e: any): string {
  if (!e) return 'unknown';
  if (typeof e === 'string') return e;
  return e.mensaje || e.detail || e.message || JSON.stringify(e).slice(0, 150);
}
function now() { return new Date().toLocaleTimeString('es-EC'); }

const CF = {
  businessName: 'consumidor final',
  ruc: '9999999999',
  email: 'noname@noname.com',
  address: 'sin direccion',
};

// ─── FASE 1: crear un documento en Contifico ──────────────────────────────────
interface DocEntry {
  orderId: string;
  name: string;
  docId: string;
  source: string;
}

async function createOne(order: any, idx: number, total: number): Promise<DocEntry | null> {
  const orderId = String(order._id);
  const name: string = order.customerName ?? orderId;

  process.stdout.write(`  [${idx}/${total}] ${name.slice(0, 40).padEnd(40)} — creando... `);

  await models.orders.findByIdAndUpdate(orderId, {
    invoiceStatus: 'PENDING',
    invoiceInfo: null,
    invoiceError: null,
    invoiceSentToSriAt: null,
  });

  const svc = getSvc(order.contificoSource);
  const orderForCF = { ...order.toObject(), invoiceData: CF, customerPhone: order.customerPhone || '' };

  const resp = await svc.createInvoice(orderForCF);

  if (!resp || resp?.error) {
    const msg = extractErr(resp?.error ?? 'null');
    await models.orders.findByIdAndUpdate(orderId, { invoiceStatus: 'ERROR', invoiceError: msg });
    console.log(`❌ ${msg.slice(0, 80)}`);
    return null;
  }

  await models.orders.findByIdAndUpdate(orderId, {
    invoiceStatus: 'PROCESSED',
    invoiceInfo: resp,
    invoiceError: null,
  });

  console.log(`✅ ${resp.id}`);
  return { orderId, name, docId: resp.id as string, source: order.contificoSource ?? 'nicole' };
}

// ─── FASE 2: esperar firma de Contifico (ciclo automático) ───────────────────
async function waitForAllSigned(docs: DocEntry[], maxMinutes = 15): Promise<Set<string>> {
  const signed = new Set<string>(); // docIds firmados
  const pending = new Map(docs.map(d => [d.docId, d])); // docId → entry

  const maxMs = maxMinutes * 60_000;
  const pollInterval = 30_000; // verificar cada 30s
  const start = Date.now();

  console.log(`\n  Esperando firma de Contifico (máx ${maxMinutes} min, polling cada 30s)...`);

  while (pending.size > 0 && Date.now() - start < maxMs) {
    await sleep(pollInterval);

    const elapsed = Math.round((Date.now() - start) / 1000);
    process.stdout.write(`\r  [${now()}] ${elapsed}s — firmados: ${signed.size}/${docs.length}, pendientes: ${pending.size}   `);

    for (const [docId, entry] of [...pending]) {
      const svc = getSvc(entry.source);
      try {
        const doc = await svc.getDocument(docId);
        if (doc?.firmado || doc?.autorizacion) {
          signed.add(docId);
          pending.delete(docId);
          if (doc?.autorizacion) {
            // Ya autorizado — guardar directamente
            await models.orders.findByIdAndUpdate(entry.orderId, {
              'invoiceInfo.autorizacion': doc.autorizacion,
              'invoiceInfo.firmado': true,
            });
            process.stdout.write(`\n  🎉 AUTORIZADO directo: ${entry.name}\n`);
          } else {
            process.stdout.write(`\n  ✍️  FIRMADO: ${entry.name}\n`);
          }
        }
      } catch { /* transient */ }

      await sleep(200); // pequeña pausa entre docs
    }
  }

  console.log(`\n\n  Ciclo de firma terminado: ${signed.size} firmados, ${pending.size} sin firmar`);
  if (pending.size > 0) {
    console.log('  ⚠️  Los no firmados quedan en Contifico — Contifico los procesará.');
  }

  return signed;
}

// ─── FASE 3: enviar al SRI + polling autorización ─────────────────────────────
async function sendAndVerify(docs: DocEntry[], signedDocIds: Set<string>): Promise<void> {
  const toSend = docs.filter(d => signedDocIds.has(d.docId));
  console.log(`\n  📤 Enviando ${toSend.length} docs al SRI...`);

  for (const entry of toSend) {
    const svc = getSvc(entry.source);

    // Verificar si ya fue autorizado en fase 2
    const check = await models.orders.findById(entry.orderId).select('invoiceInfo.autorizacion').lean() as any;
    if (check?.invoiceInfo?.autorizacion) continue; // ya guardado en fase 2

    try {
      await svc.sendToSri(entry.docId);
      await models.orders.findByIdAndUpdate(entry.orderId, { invoiceSentToSriAt: new Date() });
      process.stdout.write(`  📤 Enviado: ${entry.name.slice(0, 40)}\n`);
    } catch (err: any) {
      console.log(`  ⚠️  sendToSri falló para ${entry.name}: ${extractErr(err)}`);
    }

    await sleep(500);
  }

  // Polling de autorización: 12 rondas × 30s = 6 min
  console.log('\n  ⚡ Polling autorización SRI (máx 6 min)...');
  const waitingAuth = new Map(toSend.map(d => [d.docId, d]));
  let authorized = 0;

  for (let round = 0; round < 12 && waitingAuth.size > 0; round++) {
    await sleep(30_000);
    process.stdout.write(`\r  [${now()}] Ronda ${round + 1}/12 — autorizadas: ${authorized}, esperando: ${waitingAuth.size}   `);

    for (const [docId, entry] of [...waitingAuth]) {
      const svc = getSvc(entry.source);
      try {
        const doc = await svc.getDocument(docId);
        if (doc?.autorizacion) {
          await models.orders.findByIdAndUpdate(entry.orderId, {
            'invoiceInfo.autorizacion': doc.autorizacion,
            invoiceError: null,
          });
          waitingAuth.delete(docId);
          authorized++;
          process.stdout.write(`\n  ✅ AUTORIZADA: ${entry.name} — ${String(doc.autorizacion).slice(0, 15)}...\n`);
        }
      } catch { /* retry */ }

      await sleep(100);
    }
  }

  if (waitingAuth.size > 0) {
    console.log(`\n\n  ⏳ ${waitingAuth.size} siguen en cola SRI. Ejecuta verify:invoices en 5 min.`);
  } else {
    console.log(`\n\n  🎉 Todas autorizadas!`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const mongoUri = process.env.MONGODB_URI ?? process.env.MONGO_URI ?? process.env.DB_URI ?? '';
  if (!mongoUri) throw new Error('DB_URI no definido en .env');

  await mongoose.connect(mongoUri);
  console.log('✅ MongoDB conectado');
  console.log('ℹ️  consumidor final / 9999999999 / noname@noname.com\n');

  let query = models.orders
    .find(
      SINGLE_ORDER_ID
        ? { _id: SINGLE_ORDER_ID }
        : {
            invoiceNeeded: true,
            voidedAt: null,
            $or: [
              { invoiceStatus: { $in: ['PENDING', null, undefined, 'ERROR'] } },
              { invoiceStatus: 'PROCESSED', 'invoiceInfo.autorizacion': { $in: [null, undefined, ''] } },
            ],
          }
    )
    .sort({ createdAt: 1 });

  if (!SINGLE_ORDER_ID && isFinite(LIMIT)) query = query.limit(LIMIT) as any;

  const orders = await query;

  const limitMsg = isFinite(LIMIT) ? ` (limitado a ${LIMIT})` : '';
  console.log(`📋 ${orders.length} órdenes pendientes${limitMsg}\n`);

  if (orders.length === 0) {
    console.log('✅ Todas las facturas están autorizadas.');
    await mongoose.disconnect();
    process.exit(0);
  }

  // ════════════════════════════════════════════════════
  // FASE 1 — Crear documentos en Contifico (uno por uno)
  // ════════════════════════════════════════════════════
  console.log('═'.repeat(56));
  console.log('FASE 1 — Creando documentos en Contifico');
  console.log('═'.repeat(56) + '\n');

  const created: DocEntry[] = [];

  for (let i = 0; i < orders.length; i++) {
    const entry = await createOne(orders[i], i + 1, orders.length);
    if (entry) created.push(entry);
    if (i < orders.length - 1) await sleep(2000); // 2s entre cada uno
  }

  console.log(`\n✅ Fase 1 completa: ${created.length}/${orders.length} documentos creados\n`);

  if (created.length === 0) {
    console.log('❌ Ningún documento creado. Revisar errores.');
    await mongoose.disconnect();
    process.exit(1);
  }

  // ════════════════════════════════════════════════════
  // FASE 2 — Esperar firma de Contifico
  // ════════════════════════════════════════════════════
  console.log('═'.repeat(56));
  console.log('FASE 2 — Esperando firma de Contifico (ciclo automático)');
  console.log('═'.repeat(56));

  const signedDocIds = await waitForAllSigned(created, 15);

  if (signedDocIds.size === 0) {
    console.log('\n⚠️  Ningún doc firmado en 15 min. Contifico puede estar lento.');
    console.log('   Vuelve a ejecutar este script más tarde para continuar.\n');
    await mongoose.disconnect();
    process.exit(0);
  }

  // ════════════════════════════════════════════════════
  // FASE 3 — Enviar al SRI + polling autorización
  // ════════════════════════════════════════════════════
  console.log('\n' + '═'.repeat(56));
  console.log('FASE 3 — Enviar al SRI y verificar autorización');
  console.log('═'.repeat(56));

  await sendAndVerify(created, signedDocIds);

  // ── Resumen final ──────────────────────────────────
  const finalOrders = await models.orders
    .find({ _id: { $in: created.map(d => d.orderId) } })
    .select('customerName invoiceInfo.autorizacion invoiceStatus')
    .lean() as any[];

  const authCount = finalOrders.filter((o: any) => o?.invoiceInfo?.autorizacion).length;
  const pendingCount = finalOrders.filter((o: any) => !o?.invoiceInfo?.autorizacion && o?.invoiceStatus !== 'ERROR').length;
  const errorCount = finalOrders.filter((o: any) => o?.invoiceStatus === 'ERROR').length;

  console.log('\n' + '═'.repeat(56));
  console.log(`📊 RESUMEN FINAL (${created.length} docs creados)`);
  console.log(`  ✅ Autorizadas:   ${authCount}`);
  console.log(`  ⏳ Pendientes SRI: ${pendingCount}`);
  console.log(`  ❌ Errores:        ${errorCount}`);
  console.log('═'.repeat(56));

  if (pendingCount > 0) console.log('\n⏳ Ejecuta: pnpm verify:invoices  (en 5 min)');

  await mongoose.disconnect();
  process.exit(0);
}

process.on('SIGINT', async () => {
  console.log('\n\n⏹  Pausado. Relanza para continuar desde los pendientes.');
  await mongoose.disconnect().catch(() => {});
  process.exit(0);
});

main().catch(err => { console.error('💥', err); process.exit(1); });
