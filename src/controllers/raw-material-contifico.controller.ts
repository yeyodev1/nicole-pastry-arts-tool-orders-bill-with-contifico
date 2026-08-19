import type { Request, Response, NextFunction } from "express";
import { RawMaterialModel } from "../models/raw-material.model";
import { ContificoService } from "../services/contifico.service";

const services: Record<string, ContificoService> = {
  nicole: new ContificoService("nicole"),
  sucree: new ContificoService("sucree"),
};

/**
 * GET /api/raw-materials/:id/contifico-stock
 * Stock en vivo por bodega en Contífico para un material vinculado.
 */
export async function getContificoStock(req: Request, res: Response, next: NextFunction) {
  try {
    const material = await RawMaterialModel.findById(req.params.id).lean();
    if (!material) {
      return res.status(404).send({ message: "Material no encontrado." });
    }
    if (!material.contificoId) {
      return res.status(200).send({ linked: false, data: [] });
    }

    const source = material.contificoSource === "sucree" ? "sucree" : "nicole";
    const contifico = services[source];

    const [stock, bodegas] = await Promise.all([
      contifico.getStockByProduct(material.contificoId),
      contifico.getWarehouses(),
    ]);

    const bodegaById = new Map((bodegas || []).map((b: any) => [b.id, b.nombre]));

    const data = (Array.isArray(stock) ? stock : []).map((s: any) => ({
      bodegaId: s.bodega_id || s.bodega,
      bodega: bodegaById.get(s.bodega_id || s.bodega) || s.bodega_nombre || "Bodega",
      cantidad: parseFloat(s.cantidad ?? s.stock ?? "0") || 0,
    }));

    return res.status(200).send({
      linked: true,
      source,
      contificoId: material.contificoId,
      total: data.reduce((sum: number, d: any) => sum + d.cantidad, 0),
      data,
    });
  } catch (error) {
    console.error("Error fetching Contífico stock:", error);
    next(error);
  }
}
