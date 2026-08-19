import type { Request, Response, NextFunction } from "express";
import { ContificoService } from "../services/contifico.service";
import { ProviderModel } from "../models/provider.model";

const services: Record<string, ContificoService> = {
  nicole: new ContificoService("nicole"),
  sucree: new ContificoService("sucree"),
};

const DUE_SOON_DAYS = 7;

function computeUrgency(doc: any): "PAID" | "OVERDUE" | "DUE_SOON" | "OK" {
  // Contífico: estado 'P' = pagado/cobrado, 'C' = por cobrar/pagar (pendiente), 'A' = anulado
  const estado = (doc.estado || "").toUpperCase();
  const saldo = doc.saldo !== undefined ? Number(doc.saldo) : undefined;
  const isPaid = estado === "P" || saldo === 0;
  if (isPaid) return "PAID";

  const dueRaw = doc.fecha_vencimiento || doc.fecha_emision;
  if (!dueRaw) return "OK";
  // Formato Contífico: DD/MM/YYYY
  const parts = String(dueRaw).split("/");
  let due: Date;
  if (parts.length === 3) {
    due = new Date(Number(parts[2]), Number(parts[1]) - 1, Number(parts[0]));
  } else {
    due = new Date(dueRaw);
  }
  const now = new Date();
  const diffDays = (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (diffDays < 0) return "OVERDUE";
  if (diffDays <= DUE_SOON_DAYS) return "DUE_SOON";
  return "OK";
}

/**
 * GET /api/payables
 * Cuentas por pagar a proveedores desde Contífico, con semáforo de vencimiento.
 * Query: source (nicole|sucree), fecha_emision (DD/MM/YYYY), urgency, ruc
 */
export async function getPayables(req: Request, res: Response, next: NextFunction) {
  try {
    const source = (req.query.source as string) === "sucree" ? "sucree" : "nicole";
    const contifico = services[source];

    const params: any = { tipo_registro: "PRO" };
    if (req.query.fecha_emision) params.fecha_emision = req.query.fecha_emision;
    if (req.query.ruc) params.persona_identificacion = req.query.ruc;

    const docs = await contifico.getDocuments(params);
    const list = Array.isArray(docs) ? docs : docs?.results || [];

    // Enriquecer con días de crédito del proveedor local (match por RUC)
    const providers = await ProviderModel.find({}, "name ruc creditDays").lean();
    const byRuc = new Map(
      providers.filter((p: any) => p.ruc).map((p: any) => [String(p.ruc).trim(), p])
    );

    let payables = list.map((doc: any) => {
      const ruc = doc.persona?.ruc || doc.persona?.cedula || doc.persona_ruc || "";
      const local = byRuc.get(String(ruc).trim());
      return {
        contificoId: doc.id,
        documento: doc.documento,
        tipo: doc.tipo,
        proveedor: doc.persona?.razon_social || doc.persona?.nombre_comercial || doc.razon_social || "—",
        ruc,
        fechaEmision: doc.fecha_emision,
        fechaVencimiento: doc.fecha_vencimiento,
        total: Number(doc.total ?? 0),
        saldo: doc.saldo !== undefined ? Number(doc.saldo) : undefined,
        estado: doc.estado,
        urgency: computeUrgency(doc),
        creditDays: local?.creditDays ?? null,
        providerId: local?._id ?? null,
      };
    });

    if (req.query.urgency) {
      payables = payables.filter((p: any) => p.urgency === req.query.urgency);
    }

    // Orden: vencidas primero, luego por vencer, luego al día, pagadas al final
    const rank: Record<string, number> = { OVERDUE: 0, DUE_SOON: 1, OK: 2, PAID: 3 };
    payables.sort((a: any, b: any) => (rank[a.urgency] ?? 9) - (rank[b.urgency] ?? 9));

    const summary = {
      total: payables.length,
      overdue: payables.filter((p: any) => p.urgency === "OVERDUE").length,
      dueSoon: payables.filter((p: any) => p.urgency === "DUE_SOON").length,
      ok: payables.filter((p: any) => p.urgency === "OK").length,
      paid: payables.filter((p: any) => p.urgency === "PAID").length,
      totalPendingAmount: payables
        .filter((p: any) => p.urgency !== "PAID")
        .reduce((s: number, p: any) => s + (p.saldo ?? p.total ?? 0), 0),
    };

    res.status(200).send({ message: "Payables retrieved.", source, summary, data: payables });
  } catch (error) {
    console.error("Error fetching payables:", error);
    next(error);
  }
}
