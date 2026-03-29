/**
 * regenerate-invoices.ts
 *
 * Regenera TODAS las facturas no autorizadas por el SRI forzando un ciclo completo:
 * crear → esperar firma → enviar al SRI.
 *
 * Ejecutar:
 *   pnpm ts-node-dev scripts/regenerate-invoices.ts
 *
 * Requiere .env con: DB_URI, CONTIFICO_API_KEY, CONTIFICO_TOKEN,
 *                    CONTIFICO_SUCREE_API_KEY, CONTIFICO_SUCREE_TOKEN (opcional)
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { models } from '../src/models/index';
import { ContificoService } from '../src/services/contifico.service';

dotenv.config();

// ─── Instancias Contifico ────────────────────────────────────────────────────
const nicoleSvc = new ContificoService('nicole');
const sucreeSvc = new ContificoService('sucree');

function getSvc(source?: string): ContificoService {
  return source === 'sucree' ? sucreeSvc : nicoleSvc;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function extractErr(e: any): string {
  if (!e) return 'unknown';
  if (typeof e === 'string') return e;
  return e.mensaje || e.detail || e.message || JSON.stringify(e);
}

function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Polls svc.getDocument every 4s until firmado=true or autorizacion is set.
 * Returns full doc when ready, or null on timeout.
 */
async function waitForFirmado(svc: ContificoService, docId: string, maxMs = 32000): Promise<any> {
  const interval = 4000;
  const attempts = Math.ceil(maxMs / interval);

  for (let i = 0; i < attempts; i++) {
    await sleep(interval);
    try {
      const doc = await svc.getDocument(docId);
      if (doc?.firmado || doc?.autorizacion) return doc;
    } catch {
      // ignore transient errors, keep polling
    }
  }
  return null;
}

// ─── Result types ─────────────────────────────────────────────────────────────
type ActionCode = 'ALREADY_AUTH' | 'REGENERATED' | 'FAILED' | 'SRI_ERROR' | 'NEEDS_FIX';

interface ProcessResult {
  orderId: string;
  customerName: string;
  action: ActionCode;
  detail: string;
}

// ─── Per-order logic ──────────────────────────────────────────────────────────
async function processOrder(order: any): Promise<ProcessResult> {
  const orderId = String(order._id);
  const customerName: string = order.customerName || orderId;
  const svc = getSvc(order.contificoSource);

  try {
    // Step 1 — fetch full Contifico document if we have an ID
    let doc: any = null;
    if (order.invoiceInfo?.id) {
      try {
        doc = await svc.getDocument(order.invoiceInfo.id);
      } catch {
        // doc not found or other error → treat as no doc, proceed to recreate
        doc = null;
      }
    }

    // Step 2 — already authorized → save auth number and skip
    if (doc?.autorizacion) {
      await models.orders.findByIdAndUpdate(orderId, {
        'invoiceInfo.autorizacion': doc.autorizacion,
        invoiceError: null
      });
      return {
        orderId, customerName,
        action: 'ALREADY_AUTH',
        detail: `Auth: ${String(doc.autorizacion).slice(0, 20)}...`
      };
    }

    // Step 3 — ALWAYS force full recreate (no skipping by estado or time)
    // Facturas antiguas (~3 meses) tienen subtotal_12=0 u otros errores — nunca reparar con PUT

    // 4a — reset order state
    order.invoiceStatus = 'PENDING';
    order.invoiceInfo = null;
    order.invoiceError = null;
    order.invoiceSentToSriAt = null;
    await order.save();

    // 4b — create invoice in Contifico
    const resp = await svc.createInvoice(order);
    if (!resp || resp?.error) {
      const msg = extractErr(resp?.error || 'createInvoice returned null');

      // Data errors (email format, ID issues) → NEEDS_FIX, don't persist as ERROR
      const isDataError =
        resp?.error?.cod_error === 1519 ||
        msg.toLowerCase().includes('email') ||
        msg.toLowerCase().includes('formato') ||
        msg.toLowerCase().includes('ruc') ||
        msg.toLowerCase().includes('cedula') ||
        msg.toLowerCase().includes('identificacion');

      if (!isDataError) {
        order.invoiceStatus = 'ERROR';
        order.invoiceError = msg;
        await order.save();
      }

      return {
        orderId, customerName,
        action: isDataError ? 'NEEDS_FIX' : 'FAILED',
        detail: isDataError ? 'Formato de email incorrecto' : msg
      };
    }

    // 4c — save PROCESSED + invoiceInfo
    order.invoiceStatus = 'PROCESSED';
    order.invoiceInfo = resp;
    order.invoiceError = null;
    await order.save();

    // 4d — poll for firmado=true (max 32s)
    const firmadoDoc = await waitForFirmado(svc, resp.id);

    // 4e — persist firmado=true in DB when detected
    if (firmadoDoc?.firmado) {
      await models.orders.findByIdAndUpdate(orderId, {
        'invoiceInfo.firmado': true
      });
    }

    // 4f — send to SRI
    const sriResp = await svc.sendToSri(resp.id);
    if (sriResp?.error) {
      const msg = extractErr(sriResp.error);
      await models.orders.findByIdAndUpdate(orderId, {
        invoiceStatus: 'ERROR',
        invoiceError: msg
      });
      return { orderId, customerName, action: 'SRI_ERROR', detail: msg };
    }

    // 4g — save sentToSriAt
    await models.orders.findByIdAndUpdate(orderId, {
      invoiceSentToSriAt: new Date(),
      invoiceError: null
    });

    // 4h — return REGENERATED
    return {
      orderId, customerName,
      action: 'REGENERATED',
      detail: `Doc: ${resp.id}`
    };

  } catch (err: any) {
    const msg = extractErr(err);

    // Data errors → NEEDS_FIX (don't mark as ERROR in DB)
    const isDataError =
      err?.cod_error === 1519 ||
      msg.toLowerCase().includes('email') ||
      msg.toLowerCase().includes('formato') ||
      msg.toLowerCase().includes('ruc') ||
      msg.toLowerCase().includes('cedula') ||
      msg.toLowerCase().includes('identificacion');

    if (!isDataError) {
      try {
        order.invoiceStatus = 'ERROR';
        order.invoiceError = msg;
        await order.save();
      } catch {}
    }

    return {
      orderId, customerName,
      action: isDataError ? 'NEEDS_FIX' : 'FAILED',
      detail: isDataError ? 'Formato de email incorrecto' : msg
    };
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────
async function main() {
  await mongoose.connect(process.env.DB_URI || '');
  console.log('✅ Conectado a MongoDB\n');

  const orders = await models.orders.find({
    invoiceNeeded: true,
    voidedAt: null,
    $or: [
      { invoiceStatus: { $in: ['PENDING', null, undefined] } },
      {
        invoiceStatus: { $in: ['PROCESSED', 'ERROR'] },
        'invoiceInfo.autorizacion': { $in: [null, undefined, ''] }
      }
    ]
  }).sort({ createdAt: 1 });

  console.log(`📋 Encontradas ${orders.length} órdenes sin autorización SRI\n`);

  if (orders.length === 0) {
    console.log('✅ Todas las facturas están autorizadas — nada que hacer.');
    process.exit(0);
  }

  const summary = {
    ALREADY_AUTH: 0,
    REGENERATED: 0,
    FAILED: 0,
    SRI_ERROR: 0,
    NEEDS_FIX: 0
  };

  const CHUNK_SIZE = 3;

  for (let i = 0; i < orders.length; i += CHUNK_SIZE) {
    const chunk = orders.slice(i, i + CHUNK_SIZE);
    const results = await Promise.all(chunk.map(o => processOrder(o)));

    for (const r of results) {
      const icons: Record<ActionCode, string> = {
        REGENERATED:  '🔄',
        ALREADY_AUTH: '✅',
        FAILED:       '❌',
        SRI_ERROR:    '❌',
        NEEDS_FIX:    '⚠️ '
      };

      const shortId = r.orderId.slice(-6);
      console.log(`  ${icons[r.action]} [${r.action}] ${r.customerName} (${shortId}) — ${r.detail}`);
      summary[r.action]++;
    }

    // Pausa entre chunks para no saturar Contifico
    if (i + CHUNK_SIZE < orders.length) await sleep(2000);
  }

  console.log('\n─────────────────────────────────────────────');
  console.log(`📊 RESULTADO FINAL (${orders.length} órdenes)`);
  console.log(`  ✅ Ya autorizadas (DB desactualizada): ${summary.ALREADY_AUTH}`);
  console.log(`  🔄 Regeneradas y enviadas al SRI:      ${summary.REGENERATED}`);
  console.log(`  ❌ Fallidas (error técnico):           ${summary.FAILED}`);
  console.log(`  ❌ Error al enviar al SRI:             ${summary.SRI_ERROR}`);
  console.log(`  ⚠️  Requieren corrección manual:       ${summary.NEEDS_FIX}`);
  console.log('─────────────────────────────────────────────\n');

  if (summary.REGENERATED > 0) {
    console.log('Facturas regeneradas y enviadas al SRI. Ejecuta `verify-invoices.ts` en 5 min para guardar las autorizaciones.');
  }

  process.exit(0);
}

main().catch(err => {
  console.error('💥 Error fatal:', err);
  process.exit(1);
});
