import type { Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import { WarehouseLoanModel } from "../models/warehouse-loan.model";
import { RawMaterialModel } from "../models/raw-material.model";
import { WarehouseMovementModel } from "../models/warehouse-movement.model";
import { AuthRequest } from "../types/AuthRequest";

// Crea el par de movimientos OUT(origen) + IN(destino) para un traspaso.
// El stock global no cambia (neto cero); el stock por ubicación sí.
async function createTransferMovements(params: {
  materialId: any;
  quantity: number;
  fromPoint: string;
  toPoint: string;
  userId: any;
  responsible?: string;
  observation: string;
  batchId: string;
}) {
  const material = await RawMaterialModel.findById(params.materialId);
  if (!material) throw new Error("Materia prima no encontrada.");

  const base = {
    rawMaterial: material._id,
    quantity: params.quantity,
    unitCost: material.cost,
    totalValue: params.quantity * material.cost,
    user: params.userId,
    responsible: params.responsible,
    observation: params.observation,
    batchId: params.batchId,
  };

  await WarehouseMovementModel.insertMany([
    { ...base, type: "OUT", receptionPoint: params.fromPoint, entity: params.toPoint },
    { ...base, type: "IN", receptionPoint: params.toPoint, provider: undefined },
  ]);

  material.lastMovementDate = new Date();
  await material.save();
  return material;
}

// --- Crear préstamo/traspaso entre bodegas ---
export async function createLoan(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { fromPoint, toPoint, items, responsible, notes } = req.body;
    const userId = (req.user as any)?.id || (req.user as any)?._id;

    if (!userId) return res.status(401).send({ message: "User authentication required." });
    if (!fromPoint || !toPoint || !Array.isArray(items) || !items.length) {
      return res.status(400).send({ message: "fromPoint, toPoint and items[] are required." });
    }
    if (fromPoint === toPoint) {
      return res.status(400).send({ message: "Origen y destino no pueden ser la misma bodega." });
    }

    const batchId = randomUUID();

    for (const item of items) {
      await createTransferMovements({
        materialId: item.material,
        quantity: Number(item.quantity),
        fromPoint,
        toPoint,
        userId,
        responsible,
        observation: `Préstamo ${fromPoint} → ${toPoint}`,
        batchId,
      });
    }

    const loan = new WarehouseLoanModel({
      fromPoint,
      toPoint,
      items: items.map((i: any) => ({ ...i, quantityReturned: 0 })),
      status: "LENT",
      user: userId,
      responsible,
      notes,
      movementBatchId: batchId,
    });
    await loan.save();

    return res.status(201).send({ message: "Préstamo registrado y stock trasladado.", loan });
  } catch (error: any) {
    console.error("Error creating warehouse loan:", error);
    if (error.message?.includes("no encontrada")) {
      return res.status(404).send({ message: error.message });
    }
    next(error);
  }
}

// --- Listar préstamos (deudas pendientes primero) ---
export async function getLoans(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const query: any = {};
    if (req.query.status) query.status = req.query.status;
    if (req.query.point) {
      query.$or = [{ fromPoint: req.query.point }, { toPoint: req.query.point }];
    }

    const loans = await WarehouseLoanModel.find(query)
      .sort({ status: 1, createdAt: -1 })
      .limit(parseInt(req.query.limit as string) || 200)
      .populate("items.material", "name unit")
      .populate("user", "name");

    return res.status(200).send({ count: loans.length, loans });
  } catch (error) {
    next(error);
  }
}

// --- Registrar devolución (misma unidad: 10 chocolates → 10 chocolates) ---
export async function returnLoan(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { items: returnItems, responsible } = req.body;
    const userId = (req.user as any)?.id || (req.user as any)?._id;

    if (!userId) return res.status(401).send({ message: "User authentication required." });

    const loan = await WarehouseLoanModel.findById(id);
    if (!loan) return res.status(404).send({ message: "Loan not found." });
    if (["RETURNED", "WRITTEN_OFF"].includes(loan.status)) {
      return res.status(400).send({ message: `El préstamo ya está en estado ${loan.status}.` });
    }

    const batchId = randomUUID();

    for (const item of loan.items) {
      const ret = Array.isArray(returnItems)
        ? returnItems.find((r: any) => r.itemId === (item as any)._id?.toString())
        : undefined;
      const qty = ret ? Number(ret.quantityReturned) : item.quantity - item.quantityReturned;
      if (qty <= 0) continue;

      const pending = item.quantity - item.quantityReturned;
      if (qty > pending) {
        return res.status(400).send({
          message: `"${item.name}": devolución (${qty}) mayor a lo pendiente (${pending}).`,
        });
      }

      // Movimiento inverso: destino devuelve al origen
      await createTransferMovements({
        materialId: item.material,
        quantity: qty,
        fromPoint: loan.toPoint,
        toPoint: loan.fromPoint,
        userId,
        responsible,
        observation: `Devolución préstamo ${loan.toPoint} → ${loan.fromPoint}`,
        batchId,
      });

      item.quantityReturned += qty;
    }

    const fullyReturned = loan.items.every((i) => i.quantityReturned >= i.quantity);
    loan.status = fullyReturned ? "RETURNED" : "PARTIALLY_RETURNED";
    if (fullyReturned) loan.returnedAt = new Date();
    await loan.save();

    return res.status(200).send({
      message: fullyReturned ? "Préstamo devuelto por completo." : "Devolución parcial registrada.",
      loan,
    });
  } catch (error: any) {
    console.error("Error returning warehouse loan:", error);
    if (error.message?.includes("no encontrada")) {
      return res.status(404).send({ message: error.message });
    }
    next(error);
  }
}

// --- Dar de baja (queda como deuda asumida, no se devuelve) ---
export async function writeOffLoan(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { writeOffNote } = req.body;

    const loan = await WarehouseLoanModel.findById(id);
    if (!loan) return res.status(404).send({ message: "Loan not found." });
    if (["RETURNED", "WRITTEN_OFF"].includes(loan.status)) {
      return res.status(400).send({ message: `El préstamo ya está en estado ${loan.status}.` });
    }

    loan.status = "WRITTEN_OFF";
    loan.writtenOffAt = new Date();
    if (writeOffNote) loan.writeOffNote = writeOffNote;
    await loan.save();

    return res.status(200).send({ message: "Préstamo dado de baja (deuda asumida).", loan });
  } catch (error) {
    next(error);
  }
}
