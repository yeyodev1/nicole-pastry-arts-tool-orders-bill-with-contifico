/**
 * Sincronización de movimientos de bodega hacia Contífico.
 *
 * Cada ingreso (IN) / egreso (OUT/LOSS) hecho en la app se refleja en Contífico
 * como movimiento-inventario (ING/EGR) — solo para materiales vinculados
 * (contificoId). El resultado se guarda en el movimiento local
 * (contificoMovementId / contificoSyncStatus) para trazabilidad.
 */
import { WarehouseMovementModel } from "../models/warehouse-movement.model";

const BASE = "https://api.contifico.com/sistema/api/v1";

const KEYS: Record<"nicole" | "sucree", string | undefined> = {
  nicole: process.env.CONTIFICO_API_KEY,
  sucree: process.env.CONTIFICO_SUCREE_API_KEY,
};

// Cache de bodegas por cuenta (1h)
const bodegaCache: Record<string, { at: number; list: any[] }> = {};

function normalize(s: string) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

async function getBodegas(source: "nicole" | "sucree"): Promise<any[]> {
  const key = KEYS[source];
  if (!key) return [];
  const cached = bodegaCache[source];
  if (cached && Date.now() - cached.at < 60 * 60 * 1000) return cached.list;

  try {
    const res = await fetch(`${BASE}/bodega/`, { headers: { Authorization: key } });
    const list = res.ok ? await res.json() : [];
    bodegaCache[source] = { at: Date.now(), list: Array.isArray(list) ? list : [] };
    return bodegaCache[source].list;
  } catch {
    return cached?.list || [];
  }
}

/** Resuelve la bodega Contífico: match por nombre → "principal" → primera. */
async function resolveBodegaId(source: "nicole" | "sucree", bodegaName?: string): Promise<string | null> {
  const bodegas = await getBodegas(source);
  if (!bodegas.length) return null;

  if (bodegaName) {
    const target = normalize(bodegaName);
    const exact = bodegas.find((b: any) => normalize(b.nombre) === target);
    if (exact) return exact.id;
    const partial = bodegas.find(
      (b: any) => normalize(b.nombre).includes(target) || target.includes(normalize(b.nombre))
    );
    if (partial) return partial.id;
  }

  const principal = bodegas.find((b: any) => /principal/i.test(b.nombre));
  return (principal || bodegas[0]).id;
}

function fechaEcuador(): string {
  const now = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return `${String(now.getUTCDate()).padStart(2, "0")}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${now.getUTCFullYear()}`;
}

export interface SyncParams {
  movementId: any; // _id del WarehouseMovement local
  material: { contificoId?: string; contificoSource?: string; name?: string };
  type: "IN" | "OUT" | "LOSS";
  quantity: number;
  bodegaName?: string;
  description?: string;
}

/**
 * Empuja un movimiento a Contífico y etiqueta el movimiento local con el resultado.
 * NUNCA lanza: los errores quedan registrados en contificoSyncStatus/Error.
 */
export async function syncMovementToContifico(params: SyncParams): Promise<void> {
  const { movementId, material, type, quantity } = params;

  const tag = async (status: string, extra: Record<string, any> = {}) => {
    try {
      await WarehouseMovementModel.updateOne(
        { _id: movementId },
        { $set: { contificoSyncStatus: status, ...extra } }
      );
    } catch { /* trazabilidad best-effort */ }
  };

  try {
    if (!material?.contificoId) {
      await tag("SKIPPED");
      return;
    }
    const source = material.contificoSource === "sucree" ? "sucree" : "nicole";
    const key = KEYS[source];
    if (!key) {
      await tag("SKIPPED");
      return;
    }

    const bodegaId = await resolveBodegaId(source, params.bodegaName);
    if (!bodegaId) {
      await tag("ERROR", { contificoSyncError: "Sin bodegas en Contífico" });
      return;
    }

    const payload = {
      tipo: type === "IN" ? "ING" : "EGR",
      fecha: fechaEcuador(),
      bodega_id: bodegaId,
      descripcion: (params.description || `App Nicole — ${type} ${material.name || ""}`).slice(0, 200),
      detalles: [
        {
          producto_id: material.contificoId,
          cantidad: String(quantity),
          precio: "0.0",
        },
      ],
    };

    const res = await fetch(`${BASE}/movimiento-inventario/`, {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.status === 201 || res.status === 200) {
      const data: any = await res.json();
      await tag("SYNCED", { contificoMovementId: data.id, contificoSyncError: null });
      console.log(`🔄 Contífico sync OK: ${payload.tipo} ${data.codigo || data.id} (${material.name})`);
    } else {
      const errBody = await res.text();
      await tag("ERROR", { contificoSyncError: `HTTP ${res.status}: ${errBody.slice(0, 200)}` });
      console.error(`❌ Contífico sync falló (${res.status}) para ${material.name}:`, errBody.slice(0, 200));
    }
  } catch (err: any) {
    await tag("ERROR", { contificoSyncError: err.message?.slice(0, 200) });
    console.error("❌ Contífico sync error:", err.message);
  }
}
