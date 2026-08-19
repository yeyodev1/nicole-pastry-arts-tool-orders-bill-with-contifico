/**
 * Migración de bodega desde Contífico (Nicole + Sucree).
 *
 * 1. Respalda rawmaterials, warehousemovements y providers a JSON (scripts/backups/).
 * 2. BORRA rawmaterials y warehousemovements.
 * 3. Importa todos los productos activos (tipo PRO) de ambas cuentas Contífico
 *    como RawMaterial (con contificoId, source, categoría, stock, mínimo y costo).
 * 4. Upsertea proveedores de Contífico (personas con es_proveedor) por RUC,
 *    sin borrar los proveedores existentes.
 *
 * Uso: pnpm ts-node scripts/import-contifico-inventory.ts
 */
import mongoose from "mongoose";
import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import { RawMaterialModel } from "../src/models/raw-material.model";
import { WarehouseMovementModel } from "../src/models/warehouse-movement.model";
import { ProviderModel } from "../src/models/provider.model";

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const BASE = "https://api.contifico.com/sistema/api/v1";

const ACCOUNTS: { source: "nicole" | "sucree"; key: string | undefined }[] = [
  { source: "nicole", key: process.env.CONTIFICO_API_KEY },
  { source: "sucree", key: process.env.CONTIFICO_SUCREE_API_KEY },
];

async function cget(key: string, pathname: string) {
  const res = await fetch(`${BASE}${pathname}`, { headers: { Authorization: key } });
  if (!res.ok) throw new Error(`Contífico ${pathname} → ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data?.results || [];
}

async function fetchAllPersonas(key: string) {
  const all: any[] = [];
  for (let page = 1; page <= 20; page++) {
    const batch = await cget(key, `/persona/?result_size=500&page=${page}`);
    all.push(...batch);
    if (batch.length < 500) break;
  }
  return all;
}

async function main() {
  const dbUri = process.env.DB_URI;
  if (!dbUri) throw new Error("DB_URI no definido");
  await mongoose.connect(dbUri);
  console.log("✅ Conectado a MongoDB");

  // ---------- 1. BACKUP ----------
  const backupDir = path.resolve(__dirname, "backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");

  const [rawMats, movements, providers] = await Promise.all([
    RawMaterialModel.find().lean(),
    WarehouseMovementModel.find().lean(),
    ProviderModel.find().lean(),
  ]);

  const backupFile = path.join(backupDir, `bodega-backup-${stamp}.json`);
  fs.writeFileSync(
    backupFile,
    JSON.stringify({ rawmaterials: rawMats, warehousemovements: movements, providers }, null, 2)
  );
  console.log(`💾 Backup: ${backupFile} (${rawMats.length} materiales, ${movements.length} movimientos, ${providers.length} proveedores)`);

  // ---------- 2. WIPE bodega ----------
  const delMat = await RawMaterialModel.deleteMany({});
  const delMov = await WarehouseMovementModel.deleteMany({});
  console.log(`🗑️  Borrados: ${delMat.deletedCount} rawmaterials, ${delMov.deletedCount} warehousemovements`);

  // ---------- 3. IMPORT productos ----------
  const usedNames = new Set<string>();
  const stats: Record<string, any> = {};

  for (const { source, key } of ACCOUNTS) {
    if (!key) {
      console.warn(`⚠️  ${source}: sin API key, salto.`);
      continue;
    }

    const categorias = await cget(key, "/categoria/");
    const catById = new Map<string, string>(categorias.map((c: any) => [c.id, c.nombre]));

    const productos = await cget(key, "/producto/?result_size=2000");
    let created = 0, skipped = 0, renamed = 0;

    for (const p of productos) {
      if (p.tipo !== "PRO" || p.estado !== "A") { skipped++; continue; }

      let name: string = String(p.nombre || "").trim();
      if (!name) { skipped++; continue; }
      if (usedNames.has(name.toLowerCase())) {
        name = `${name} (${source === "sucree" ? "Sucree" : "Nicole"} ${p.codigo || p.id})`;
        renamed++;
      }
      usedNames.add(name.toLowerCase());

      await RawMaterialModel.create({
        name,
        code: p.codigo || undefined,
        unit: "u",
        quantity: parseFloat(p.cantidad_stock || "0") || 0,
        cost: parseFloat(p.costo_maximo || "0") || 0,
        minStock: parseFloat(p.minimo || "0") || 0,
        maxStock: 0,
        category: catById.get(p.categoria_id) || "Sin Categoría",
        contificoId: p.id,
        contificoSource: source,
        presentationQuantity: 1,
      });
      created++;
    }

    stats[source] = { productos: productos.length, created, skipped, renamed };
    console.log(`📦 ${source}: ${created} materiales creados (${skipped} saltados, ${renamed} renombrados por duplicado)`);

    // ---------- 4. Proveedores ----------
    const personas = await fetchAllPersonas(key);
    const provs = personas.filter((x: any) => x.es_proveedor === true);
    let provCreated = 0, provUpdated = 0, provSkipped = 0;

    for (const pr of provs) {
      const ruc = (pr.ruc || pr.cedula || "").trim();
      const provName = (pr.razon_social || pr.nombre_comercial || "").trim();
      if (!provName) { provSkipped++; continue; }

      const existing = ruc
        ? await ProviderModel.findOne({ $or: [{ ruc }, { name: provName }] })
        : await ProviderModel.findOne({ name: provName });

      if (existing) {
        existing.contificoPersonaId = pr.id;
        if (!existing.ruc && ruc) existing.ruc = ruc;
        if (!existing.email && pr.email) existing.email = pr.email;
        if (!existing.phone && pr.telefonos) existing.phone = pr.telefonos;
        if (!existing.address && pr.direccion) existing.address = pr.direccion;
        await existing.save();
        provUpdated++;
      } else {
        try {
          await ProviderModel.create({
            name: provName,
            ruc: ruc || undefined,
            email: pr.email || undefined,
            phone: pr.telefonos || undefined,
            address: pr.direccion || undefined,
            contificoPersonaId: pr.id,
            creditDays: 0,
            commercialAgents: [],
          });
          provCreated++;
        } catch { provSkipped++; }
      }
    }

    stats[source].proveedores = { total: provs.length, created: provCreated, updated: provUpdated, skipped: provSkipped };
    console.log(`🏭 ${source}: proveedores → ${provCreated} nuevos, ${provUpdated} actualizados, ${provSkipped} saltados (de ${provs.length})`);
  }

  console.log("\n✨ Migración completa:", JSON.stringify(stats, null, 2));
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Migración falló:", err);
  process.exit(1);
});
