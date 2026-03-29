/**
 * fix-all-invoices.ts
 *
 * Script de reparación masiva de facturas — procesa TODAS las órdenes
 * con invoiceNeeded=true que no tengan autorización del SRI.
 *
 * Ejecutar:
 *   pnpm ts-node-dev scripts/fix-all-invoices.ts
 *   (o)
 *   npx ts-node --transpile-only scripts/fix-all-invoices.ts
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

// Usa Number() para manejar "0", "0.0", "0.00" y el número 0 por igual.
// Reproduce exactamente la lógica del frontend (isBrokenInvoice):
//   subtotal_12=0 AND subtotal_0=0 AND iva>0 → factura rota
function isBrokenSubtotal(invoiceInfo: any): boolean {
  const sub12 = Number(invoiceInfo?.subtotal_12 ?? 0);
  const sub0  = Number(invoiceInfo?.subtotal_0  ?? 0);
  const iva   = Number(invoiceInfo?.iva         ?? 0);
  // Si no hay dato de subtotales (invoiceInfo vacío), asumir roto por seguridad
  if (invoiceInfo?.subtotal_12 == null) return true;
  return sub12 === 0 && sub0 === 0 && iva > 0;
}

async function sleep(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

// ─── Lógica principal ─────────────────────────────────────────────────────────
async function processOrder(order: any): Promise<{
  orderId: string;
  customerName: string;
  action: string;
  detail: string;
}> {
  const orderId = String(order._id);
  const customerName: string = order.customerName || orderId;
  const svc = getSvc(order.contificoSource);

  try {
    // ── Sin factura en Contifico → crear desde cero ──────────────────────────
    if (!order.invoiceInfo?.id) {
      order.invoiceStatus = 'PENDING';
      order.invoiceInfo = null;
      order.invoiceError = null;
      order.invoiceSentToSriAt = null;
      order.invoiceNeeded = true;
      await order.save();

      const resp = await svc.createInvoice(order);
      if (resp?.error) {
        const msg = extractErr(resp.error);
        order.invoiceStatus = 'ERROR';
        order.invoiceError = msg;
        await order.save();
        return { orderId, customerName, action: 'FAILED', detail: msg };
      }

      order.invoiceStatus = 'PROCESSED';
      order.invoiceInfo = resp;
      order.invoiceError = null;
      await order.save();

      // Enviar al SRI de forma asíncrona (no bloquear)
      svc.sendToSriWhenReady(resp.id)
        .then(async (r: any) => {
          await models.orders.findByIdAndUpdate(orderId, {
            invoiceSentToSriAt: new Date(),
            ...(r?.error ? { invoiceStatus: 'ERROR', invoiceError: extractErr(r.error) } : { invoiceError: null })
          });
        })
        .catch(() => {});

      return { orderId, customerName, action: 'CREATED', detail: `Doc: ${resp.id}` };
    }

    // ── Tiene doc en Contifico → consultar documento COMPLETO ───────────────
    // Usamos getDocument (no getDocumentEstado) porque:
    //   1. Tiene el campo `autorizacion` con el número del SRI
    //   2. Tiene `firmado` (boolean) y `estado` en un solo request
    //   3. Evita la segunda llamada para obtener el número de autorización
    let fullDoc: any;
    try {
      fullDoc = await svc.getDocument(order.invoiceInfo.id);
    } catch (err: any) {
      const msg: string = err?.message || '';
      if (msg.toLowerCase().includes('no existe') || msg.toLowerCase().includes('not found') || msg.includes('404')) {
        // Doc eliminado en Contifico → recrear desde cero
        order.invoiceStatus = 'PENDING';
        order.invoiceInfo = null;
        order.invoiceError = null;
        order.invoiceSentToSriAt = null;
        await order.save();

        const resp = await svc.createInvoice(order);
        if (resp?.error) {
          const errMsg = extractErr(resp.error);
          order.invoiceStatus = 'ERROR'; order.invoiceError = errMsg;
          await order.save();
          return { orderId, customerName, action: 'FAILED', detail: errMsg };
        }
        order.invoiceStatus = 'PROCESSED'; order.invoiceInfo = resp; order.invoiceError = null;
        await order.save();
        svc.sendToSriWhenReady(resp.id).then(async (r: any) => {
          await models.orders.findByIdAndUpdate(orderId, {
            invoiceSentToSriAt: new Date(),
            ...(r?.error ? { invoiceStatus: 'ERROR', invoiceError: extractErr(r.error) } : { invoiceError: null })
          });
        }).catch(() => {});
        return { orderId, customerName, action: 'RECREATED', detail: `Doc anterior inexistente. Nuevo: ${resp.id}` };
      }
      throw err;
    }

    // ── YA AUTORIZADO → guardar número en DB y terminar ─────────────────────
    const autorizacion: string = fullDoc?.autorizacion || '';
    if (autorizacion) {
      await models.orders.findByIdAndUpdate(orderId, {
        'invoiceInfo.autorizacion': autorizacion,
        invoiceError: null
      });
      return { orderId, customerName, action: 'ALREADY_AUTH', detail: `Auth: ${autorizacion.slice(0, 20)}...` };
    }

    // Estado del doc (para decidir qué hacer)
    const firmado: boolean = !!fullDoc?.firmado;
    // estadoCode: "C"=Creado/Firmado, "P"=Pendiente SRI, "E"=Enviado SRI, "A"=Autorizado
    const estadoCode: string = fullDoc?.estado || '';
    // texto legible de la firma
    const estadoFirma: string = fullDoc?.estado_firma || '';

    // ── EN COLA DEL SRI (ya enviado, esperando respuesta) ───────────────────
    // estado="P" o "E" significa que ya está en el proceso del SRI — no tocar
    if ((estadoCode === 'P' || estadoCode === 'E') && !isBrokenSubtotal(fullDoc)) {
      return { orderId, customerName, action: 'PENDING_SRI', detail: `En cola SRI (estado: ${estadoCode})` };
    }

    // ── FIRMADO → SIEMPRE reparar via PUT para garantizar subtotales correctos ─
    // No confiamos en los subtotales del doc existente porque pueden tener el
    // bug (subtotal_12=0). El PUT recalcula desde los productos del pedido.
    if (firmado || estadoCode === 'C') {
      const docId = order.invoiceInfo?.id;
      let repaired: any = null;
      try {
        repaired = await svc.repairDocument(docId, order);
      } catch { repaired = null; }

      if (repaired && !repaired?.error) {
        order.invoiceStatus = 'PROCESSED';
        order.invoiceInfo = repaired;
        order.invoiceError = null;
        await order.save();
        svc.sendToSriWhenReady(repaired.id).then(async (r: any) => {
          await models.orders.findByIdAndUpdate(orderId, {
            invoiceSentToSriAt: new Date(),
            ...(r?.error ? { invoiceStatus: 'ERROR', invoiceError: extractErr(r.error) } : { invoiceError: null })
          });
        }).catch(() => {});
        return { orderId, customerName, action: 'REPAIRED', detail: `Doc: ${repaired.id} (PUT + sendToSriWhenReady)` };
      }
      // PUT falló → caer a recrear abajo
    }

    // ── NO FIRMADO / Enviado SRI con bug / estado desconocido → reparar o recrear ─
    const docId = order.invoiceInfo?.id;
    let repaired: any = null;

    if (docId) {
      try {
        repaired = await svc.repairDocument(docId, order);
      } catch {
        repaired = null;
      }
    }

    if (!repaired || repaired?.error) {
      const repairMsg = repaired ? extractErr(repaired.error) : '';

      // Bloqueo de inventario Contifico → no podemos tocar este doc
      if (repairMsg.toLowerCase().includes('duplicate entry')) {
        order.invoiceStatus = 'ERROR';
        order.invoiceError = `Bloqueo inventario Contifico: ${repairMsg}`;
        await order.save();
        return { orderId, customerName, action: 'BLOCKED', detail: repairMsg.slice(0, 120) };
      }

      // Intentar recrear
      const savedInfo = order.invoiceInfo;
      order.invoiceStatus = 'PENDING'; order.invoiceInfo = null;
      order.invoiceError = null; order.invoiceSentToSriAt = null;
      await order.save();

      repaired = await svc.createInvoice(order);
      if (!repaired || repaired?.error) {
        order.invoiceStatus = 'ERROR';
        order.invoiceInfo = savedInfo;
        order.invoiceError = repaired ? extractErr(repaired.error) : 'createInvoice returned null';
        await order.save();
        return { orderId, customerName, action: 'FAILED', detail: order.invoiceError as string };
      }
    }

    order.invoiceStatus = 'PROCESSED';
    order.invoiceInfo = repaired;
    order.invoiceError = null;
    await order.save();

    svc.sendToSriWhenReady(repaired.id).then(async (r: any) => {
      await models.orders.findByIdAndUpdate(orderId, {
        invoiceSentToSriAt: new Date(),
        ...(r?.error ? { invoiceStatus: 'ERROR', invoiceError: extractErr(r.error) } : { invoiceError: null })
      });
    }).catch(() => {});

    return {
      orderId, customerName, action: 'REPAIRED',
      detail: `Doc: ${repaired.id}`
    };

  } catch (err: any) {
    const msg = err?.message || String(err);
    // Errores de datos que requieren corrección manual — no guardar como ERROR
    // para que el script no los reintente infinitamente
    const isDataError = msg.includes('email') || msg.includes('Formato') ||
      msg.includes('ruc') || msg.includes('cedula') || msg.includes('identificacion');
    if (!isDataError) {
      try {
        order.invoiceStatus = 'ERROR'; order.invoiceError = msg;
        await order.save();
      } catch {}
    }
    return { orderId, customerName, action: isDataError ? 'NEEDS_FIX' : 'FAILED', detail: msg };
  }
}

// ─── Runner ───────────────────────────────────────────────────────────────────
async function main() {
  await mongoose.connect(process.env.DB_URI || '');
  console.log('✅ Conectado a MongoDB\n');

  // ── HISTÓRICO COMPLETO: todas las órdenes que necesitan factura y no están autorizadas ──
  // Cubre todos los casos posibles:
  //   1. PENDING / null / undefined → nunca se facturó (necesitan createInvoice)
  //   2. ERROR → falló en algún punto (reintentar)
  //   3. PROCESSED con autorizacion vacía → factura existe pero SRI no autorizó
  const orders = await models.orders.find({
    invoiceNeeded: true,
    voidedAt: null,
    $or: [
      // Nunca procesadas o pendientes
      { invoiceStatus: { $in: ['PENDING', null, undefined] } },
      // Procesadas pero sin autorización SRI
      {
        invoiceStatus: { $in: ['PROCESSED', 'ERROR'] },
        'invoiceInfo.autorizacion': { $in: [null, undefined, ''] }
      }
    ]
  }).sort({ createdAt: 1 }); // del más antiguo al más nuevo

  console.log(`📋 Encontradas ${orders.length} órdenes sin autorización SRI\n`);

  if (orders.length === 0) {
    console.log('✅ Todas las facturas están autorizadas — nada que hacer.');
    process.exit(0);
  }

  const summary = { total: orders.length, created: 0, repaired: 0, sentSri: 0, alreadyAuth: 0, pendingSri: 0, blocked: 0, failed: 0, needsFix: 0 };
  const failures: Array<{ orderId: string; customerName: string; detail: string }> = [];
  const needsFixList: Array<{ orderId: string; customerName: string; detail: string }> = [];

  const CHUNK = 3; // 3 en paralelo para no saturar Contifico

  for (let i = 0; i < orders.length; i += CHUNK) {
    const chunk = orders.slice(i, i + CHUNK);
    const results = await Promise.all(chunk.map(o => processOrder(o)));

    for (const r of results) {
      const icon = r.action === 'FAILED' ? '❌' : r.action === 'NEEDS_FIX' ? '⚠️ ' :
        r.action === 'BLOCKED' ? '⛔' : r.action.startsWith('ALREADY') ? '✅' :
        r.action === 'PENDING_SRI' ? '⏳' : '🔄';
      console.log(`  ${icon} [${r.action}] ${r.customerName} (${r.orderId.slice(-6)}) — ${r.detail}`);

      switch (r.action) {
        case 'CREATED':   case 'RECREATED': summary.created++;  break;
        case 'REPAIRED':                    summary.repaired++; break;
        case 'SENT_SRI':                    summary.sentSri++;  break;
        case 'ALREADY_AUTH':                summary.alreadyAuth++; break;
        case 'PENDING_SRI':                 summary.pendingSri++; break;
        case 'BLOCKED':                     summary.blocked++;  break;
        case 'NEEDS_FIX':
          summary.needsFix++;
          needsFixList.push({ orderId: r.orderId, customerName: r.customerName, detail: r.detail });
          break;
        case 'FAILED':
          summary.failed++;
          failures.push({ orderId: r.orderId, customerName: r.customerName, detail: r.detail });
          break;
      }
    }

    // Pequeña pausa entre chunks para no saturar la API de Contifico
    if (i + CHUNK < orders.length) await sleep(1500);
  }

  console.log('\n─────────────────────────────────────────────');
  console.log(`📊 RESULTADO FINAL (${orders.length} órdenes)`);
  console.log(`  ✅ Ya autorizadas (DB desactualizada): ${summary.alreadyAuth}`);
  console.log(`  🔄 Recreadas/Nuevas:                   ${summary.created}`);
  console.log(`  🔧 Reparadas (PUT):                    ${summary.repaired}`);
  console.log(`  📤 Enviadas al SRI:                    ${summary.sentSri}`);
  console.log(`  ⏳ En cola del SRI (esperando):        ${summary.pendingSri}`);
  console.log(`  ⛔ Bloqueadas (inventario Contifico):  ${summary.blocked}`);
  console.log(`  ❌ Fallidas (error técnico):           ${summary.failed}`);
  console.log(`  ⚠️  Requieren corrección manual:       ${summary.needsFix}`);

  if (needsFixList.length > 0) {
    console.log('\n⚠️  Órdenes que necesitan corrección de datos antes de poder facturar:');
    for (const f of needsFixList) {
      console.log(`  • ${f.customerName} (${f.orderId})`);
      console.log(`    → ${f.detail}`);
      console.log(`    → Corrige en la UI: edita datos de facturación (RUC/email/dirección)`);
    }
  }

  if (failures.length > 0) {
    console.log('\n❌ Órdenes con error técnico:');
    for (const f of failures) {
      console.log(`  • ${f.customerName} (${f.orderId}) → ${f.detail}`);
    }
  }

  if (summary.repaired > 0 || summary.pendingSri > 0 || summary.sentSri > 0) {
    console.log(`\n⏳ ${summary.repaired} facturas reparadas y enviadas al SRI.`);
    console.log('   El SRI puede tardar 2-10 minutos. Vuelve a ejecutar en 5 min para guardar las autorizaciones.');
  }

  if (summary.alreadyAuth > 0) {
    console.log(`\n✅ ${summary.alreadyAuth} facturas ya autorizadas — número de autorización guardado en DB.`);
  }

  console.log('─────────────────────────────────────────────\n');
  process.exit(0);
}

main().catch(err => {
  console.error('💥 Error fatal:', err);
  process.exit(1);
});
