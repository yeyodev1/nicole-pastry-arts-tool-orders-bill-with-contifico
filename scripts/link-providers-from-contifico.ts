/**
 * Relaciona materia prima ↔ proveedores usando las facturas de COMPRA de Contífico.
 *
 * Recorre todos los documentos tipo_registro=PRO (compras a proveedores) de ambas
 * cuentas, y por cada línea con producto_id registra qué proveedor lo vendió,
 * a qué precio y cuándo. Con eso:
 *   - RawMaterial.providers[] = todos los proveedores históricos (precio de su última venta)
 *   - RawMaterial.provider    = proveedor de la compra más reciente (isMain)
 *   - RawMaterial.cost        = precio unitario de la última compra
 *   - lastInvoice / lastMovementDate desde esa compra
 * Crea el Provider si no existe (match por contificoPersonaId → RUC → nombre).
 *
 * Uso: npx ts-node scripts/link-providers-from-contifico.ts
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import { RawMaterialModel } from "../src/models/raw-material.model";
import { ProviderModel } from "../src/models/provider.model";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const BASE = "https://api.contifico.com/sistema/api/v1";

const ACCOUNTS: { source: "nicole" | "sucree"; key: string | undefined }[] = [
  { source: "nicole", key: process.env.CONTIFICO_API_KEY },
  { source: "sucree", key: process.env.CONTIFICO_SUCREE_API_KEY },
];

interface PurchaseRecord {
  personaId: string;
  ruc: string;
  razonSocial: string;
  fecha: Date;
  precio: number;
  documento: string;
}

function parseFecha(f: string): Date {
  // Contífico: DD/MM/YYYY
  const [d, m, y] = String(f || "").split("/").map(Number);
  return y ? new Date(y, m - 1, d) : new Date(0);
}

async function fetchPurchaseDocs(key: string) {
  // La API ignora `page` — pedir todo en una sola llamada grande.
  for (const size of [10000, 5000, 2000, 1000]) {
    const res = await fetch(
      `${BASE}/registro/documento/?tipo_registro=PRO&result_size=${size}`,
      { headers: { Authorization: key } }
    );
    if (!res.ok) continue;
    const data = await res.json();
    const batch = Array.isArray(data) ? data : data?.results || [];
    if (batch.length) {
      console.log(`   result_size=${size} → ${batch.length} docs (${batch[batch.length - 1]?.fecha_emision} a ${batch[0]?.fecha_emision})`);
      return batch;
    }
  }
  return [];
}

/** Crea un RawMaterial desde el detalle del producto en Contífico. */
async function createMaterialFromContifico(
  key: string,
  source: "nicole" | "sucree",
  productoId: string,
  usedNames: Set<string>
) {
  const res = await fetch(`${BASE}/producto/${productoId}/`, { headers: { Authorization: key } });
  if (!res.ok) return null;
  const p = await res.json();
  if (!p?.nombre) return null;

  let name = String(p.nombre).trim();
  if (usedNames.has(name.toLowerCase())) {
    name = `${name} (${p.codigo || productoId})`;
  }
  usedNames.add(name.toLowerCase());

  try {
    return await RawMaterialModel.create({
      name,
      code: p.codigo || undefined,
      unit: "u",
      quantity: parseFloat(p.cantidad_stock || "0") || 0,
      cost: parseFloat(p.costo_maximo || "0") || 0,
      minStock: parseFloat(p.minimo || "0") || 0,
      maxStock: 0,
      category: "Sin Categoría",
      contificoId: p.id,
      contificoSource: source,
      fromContifico: true,
      presentationQuantity: 1,
    });
  } catch {
    return null;
  }
}

async function findOrCreateProvider(rec: PurchaseRecord, cache: Map<string, any>) {
  if (cache.has(rec.personaId)) return cache.get(rec.personaId);

  let provider =
    (await ProviderModel.findOne({ contificoPersonaId: rec.personaId })) ||
    (rec.ruc ? await ProviderModel.findOne({ ruc: rec.ruc }) : null) ||
    (rec.razonSocial ? await ProviderModel.findOne({ name: rec.razonSocial }) : null);

  if (provider) {
    let dirty = false;
    if (!provider.contificoPersonaId) { provider.contificoPersonaId = rec.personaId; dirty = true; }
    if (!provider.ruc && rec.ruc) { provider.ruc = rec.ruc; dirty = true; }
    if (!provider.fromContifico) { provider.fromContifico = true; dirty = true; }
    if (dirty) await provider.save();
  } else if (rec.razonSocial) {
    provider = await ProviderModel.create({
      name: rec.razonSocial,
      ruc: rec.ruc || undefined,
      contificoPersonaId: rec.personaId,
      fromContifico: true,
      creditDays: 0,
      commercialAgents: [],
    });
  }

  cache.set(rec.personaId, provider);
  return provider;
}

async function main() {
  const dbUri = process.env.DB_URI;
  if (!dbUri) throw new Error("DB_URI no definido");
  await mongoose.connect(dbUri);
  console.log("✅ Conectado a MongoDB");

  const totals: Record<string, any> = {};

  for (const { source, key } of ACCOUNTS) {
    if (!key) continue;

    console.log(`\n📥 ${source}: descargando facturas de compra...`);
    const docs = await fetchPurchaseDocs(key);
    console.log(`   ${docs.length} documentos de compra`);

    // producto_id -> historial de compras
    const byProduct = new Map<string, PurchaseRecord[]>();
    let lines = 0;

    for (const doc of docs) {
      if (doc.anulado) continue;
      const persona = doc.persona || {};
      if (!persona.id) continue;

      for (const line of doc.detalles || []) {
        if (!line.producto_id) continue;
        lines++;
        const rec: PurchaseRecord = {
          personaId: persona.id,
          ruc: (persona.ruc || persona.cedula || "").trim(),
          razonSocial: (persona.razon_social || persona.nombre_comercial || "").trim(),
          fecha: parseFecha(doc.fecha_emision),
          precio: parseFloat(line.precio || "0") || 0,
          documento: doc.documento || "",
        };
        if (!byProduct.has(line.producto_id)) byProduct.set(line.producto_id, []);
        byProduct.get(line.producto_id)!.push(rec);
      }
    }
    console.log(`   ${lines} líneas con producto, ${byProduct.size} productos distintos con compras`);

    // Aplicar a RawMaterials de esta cuenta
    const providerCache = new Map<string, any>();
    const usedNames = new Set<string>(
      (await RawMaterialModel.find({}, "name").lean()).map((m: any) => String(m.name).toLowerCase())
    );
    let linked = 0, notFound = 0, createdMissing = 0;

    for (const [productoId, records] of byProduct) {
      let material = await RawMaterialModel.findOne({ contificoId: productoId, contificoSource: source });
      if (!material) {
        // Producto comprado que no vino en el listado (/producto/ solo lista los para_pos):
        // lo traemos por id y lo creamos — es materia prima real.
        material = await createMaterialFromContifico(key!, source, productoId, usedNames);
        if (material) createdMissing++;
      }
      if (!material) { notFound++; continue; }

      records.sort((a, b) => b.fecha.getTime() - a.fecha.getTime()); // más reciente primero

      // último precio por proveedor
      const latestByPersona = new Map<string, PurchaseRecord>();
      for (const r of records) {
        if (!latestByPersona.has(r.personaId)) latestByPersona.set(r.personaId, r);
      }

      const providerEntries: any[] = [];
      let mainProviderId: any = null;

      for (const [personaId, rec] of latestByPersona) {
        const provider = await findOrCreateProvider(rec, providerCache);
        if (!provider) continue;
        const isMain = personaId === records[0].personaId;
        providerEntries.push({ provider: provider._id, price: rec.precio, isMain });
        if (isMain) mainProviderId = provider._id;
      }

      if (!providerEntries.length) continue;

      material.providers = providerEntries as any;
      material.provider = mainProviderId;
      if (records[0].precio > 0) material.cost = records[0].precio;
      if (records[0].documento) material.lastInvoice = records[0].documento;
      material.lastMovementDate = records[0].fecha;
      await material.save();
      linked++;
    }

    totals[source] = { docs: docs.length, lineas: lines, productosConCompras: byProduct.size, materialesVinculados: linked, materialesCreados: createdMissing, sinMatch: notFound };
    console.log(`🔗 ${source}: ${linked} materiales vinculados (${createdMissing} creados desde compras, ${notFound} sin resolver)`);
  }

  console.log("\n✨ Resultado:", JSON.stringify(totals, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Falló:", err);
  process.exit(1);
});
