import type { Response, NextFunction } from "express";
import { WarehouseMovementModel } from "../models/warehouse-movement.model";
import { AuthRequest } from "../types/AuthRequest";

/**
 * GET /api/warehouse/expiring?days=30
 * Lotes ingresados con fecha de caducidad próxima o vencida.
 */
export async function getExpiring(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const limitDate = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    const movements = await WarehouseMovementModel.find({
      type: "IN",
      expiryDate: { $ne: null, $lte: limitDate },
    })
      .sort({ expiryDate: 1 })
      .limit(500)
      .populate("rawMaterial", "name unit quantity")
      .populate("provider", "name");

    const now = new Date();
    const data = movements.map((m: any) => ({
      _id: m._id,
      material: m.rawMaterial,
      provider: m.provider,
      quantity: m.quantity,
      receptionPoint: m.receptionPoint,
      invoiceRef: m.invoiceRef,
      expiryDate: m.expiryDate,
      date: m.date,
      status: m.expiryDate < now ? "EXPIRED" : "EXPIRING_SOON",
    }));

    res.status(200).send({
      count: data.length,
      expired: data.filter((d) => d.status === "EXPIRED").length,
      data,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/warehouse/dispatch-summary?from=YYYY-MM-DD&to=YYYY-MM-DD&entity=La Creme
 * Suma de todos los ítems despachados (OUT) en un rango, agrupado por ítem.
 * Reemplaza el Excel manual de envíos (ej. a La Crème).
 */
export async function getDispatchSummary(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { from, to, entity } = req.query;
    if (!from || !to) {
      return res.status(400).send({ message: "from and to query params are required (YYYY-MM-DD)." });
    }

    const match: any = {
      type: "OUT",
      date: {
        $gte: new Date(from as string),
        $lte: new Date(`${to}T23:59:59.999Z`),
      },
    };
    if (entity) {
      match.entity = { $regex: new RegExp(String(entity).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") };
    }

    const summary = await WarehouseMovementModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: { rawMaterial: "$rawMaterial", entity: "$entity" },
          totalQuantity: { $sum: "$quantity" },
          totalValue: { $sum: { $ifNull: ["$totalValue", 0] } },
          movements: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: "rawmaterials",
          localField: "_id.rawMaterial",
          foreignField: "_id",
          as: "material",
        },
      },
      { $unwind: { path: "$material", preserveNullAndEmptyArrays: true } },
      {
        $project: {
          _id: 0,
          entity: "$_id.entity",
          materialId: "$_id.rawMaterial",
          materialName: "$material.name",
          unit: "$material.unit",
          totalQuantity: 1,
          totalValue: 1,
          movements: 1,
        },
      },
      { $sort: { entity: 1, materialName: 1 } },
    ]);

    const totals = {
      items: summary.length,
      totalValue: summary.reduce((s: number, r: any) => s + (r.totalValue || 0), 0),
    };

    res.status(200).send({ from, to, entity: entity || null, totals, data: summary });
  } catch (error) {
    next(error);
  }
}
