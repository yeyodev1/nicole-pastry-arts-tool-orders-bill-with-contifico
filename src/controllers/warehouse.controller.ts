import type { Request, Response, NextFunction } from "express";
import { WarehouseMovementModel } from "../models/warehouse-movement.model";
import { RawMaterialModel } from "../models/raw-material.model";
import { Types } from "mongoose";
import { randomUUID } from "crypto";

interface IAuthRequest extends Request {
  user?: any;
}

// --- Create Movement ---
async function createMovement(req: IAuthRequest, res: Response, next: NextFunction) {
  try {
    const {
      type, rawMaterial, quantity, provider, entity, observation,
      responsible, receptionPoint,
    } = req.body;
    let { unitCost, totalValue } = req.body;
    const userId = req.user?.id || req.body.user;

    if (!userId) {
      return res.status(401).send({ message: "User authentication required." });
    }

    if (!type || !rawMaterial || !quantity) {
      return res.status(400).send({ message: "Type, Raw Material, and Quantity are required." });
    }

    if (quantity <= 0) {
      return res.status(400).send({ message: "Quantity must be greater than 0." });
    }

    const material = await RawMaterialModel.findById(rawMaterial);
    if (!material) {
      return res.status(404).send({ message: "Raw Material not found." });
    }

    // Auto-calculate values for OUT/LOSS if not provided
    if ((type === "OUT" || type === "LOSS") && unitCost === undefined) {
      unitCost = material.cost;
      totalValue = quantity * material.cost;
    }

    if (type === "OUT" || type === "LOSS") {
      // If a source location is specified, verify its local stock
      if (receptionPoint) {
        const [locAgg] = await WarehouseMovementModel.aggregate([
          { $match: { rawMaterial: material._id, receptionPoint } },
          {
            $group: {
              _id: null,
              inQty:  { $sum: { $cond: [{ $eq: ["$type", "IN"]   }, "$quantity", 0] } },
              outQty: { $sum: { $cond: [{ $in: ["$type", ["OUT", "LOSS"]] }, "$quantity", 0] } },
            },
          },
        ]);
        const locationQty = locAgg ? locAgg.inQty - locAgg.outQty : 0;
        if (locationQty < quantity) {
          return res.status(400).send({
            message: `Stock insuficiente en "${receptionPoint}". Disponible: ${locationQty} ${material.unit}`,
          });
        }
      } else if (material.quantity < quantity) {
        return res.status(400).send({
          message: `Insufficient stock. Available: ${material.quantity} ${material.unit}`,
        });
      }
      material.quantity -= quantity;
    } else if (type === "IN") {
      material.quantity += quantity;
    } else {
      return res.status(400).send({ message: "Invalid movement type." });
    }

    const movement = new WarehouseMovementModel({
      type,
      rawMaterial,
      quantity,
      unitCost:       unitCost   !== undefined ? Number(unitCost)   : undefined,
      totalValue:     totalValue !== undefined ? Number(totalValue) : undefined,
      provider:       type === "IN"  ? provider       : undefined,
      entity:         type === "OUT" ? entity         : undefined,
      receptionPoint: receptionPoint || undefined,
      user: userId,
      responsible,
      observation,
      date: req.body.date ? new Date(req.body.date) : new Date(),
      expiryDate: type === "IN" && req.body.expiryDate ? new Date(req.body.expiryDate) : undefined,
    });

    await Promise.all([movement.save(), material.save()]);

    return res.status(201).send({
      message: "Movement created successfully.",
      movement,
      currentStock: material.quantity,
    });
  } catch (error) {
    console.error("Error creating warehouse movement:", error);
    next(error);
  }
}

// --- Stock by location (aggregated from movements) ---
async function getStockByLocation(req: Request, res: Response, next: NextFunction) {
  try {
    const { rawMaterialId } = req.params;

    if (!Types.ObjectId.isValid(rawMaterialId)) {
      return res.status(400).send({ message: "Invalid raw material ID." });
    }

    const result = await WarehouseMovementModel.aggregate([
      { $match: { rawMaterial: new Types.ObjectId(rawMaterialId) } },
      {
        $group: {
          _id:     { $ifNull: ["$receptionPoint", "__sin_bodega__"] },
          inQty:   { $sum: { $cond: [{ $eq: ["$type", "IN"] },             "$quantity", 0] } },
          outQty:  { $sum: { $cond: [{ $in: ["$type", ["OUT", "LOSS"]] }, "$quantity", 0] } },
        },
      },
      {
        $project: {
          _id: 0,
          location: "$_id",
          stock: { $subtract: ["$inQty", "$outQty"] },
        },
      },
      { $match: { stock: { $gt: 0 }, location: { $ne: "__sin_bodega__" } } },
      { $sort: { stock: -1 } },
    ]);

    return res.status(200).send({ data: result });
  } catch (error) {
    next(error);
  }
}

// --- Get Movements (History) ---
async function getMovements(req: Request, res: Response, next: NextFunction) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const query: any = {};
    if (req.query.type) query.type = req.query.type;
    if (req.query.materialId) query.rawMaterial = req.query.materialId;
    if (req.query.receptionPoint) query.receptionPoint = req.query.receptionPoint;

    if (req.query.startDate || req.query.endDate) {
      query.date = {};
      if (req.query.startDate) {
        query.date.$gte = new Date(`${req.query.startDate}T00:00:00-05:00`);
      }
      if (req.query.endDate) {
        query.date.$lte = new Date(`${req.query.endDate}T23:59:59-05:00`);
      }
    }

    // Build aggregate match (same filters, but rawMaterial must be ObjectId)
    const aggregateMatch: any = { ...query };
    if (aggregateMatch.rawMaterial) {
      aggregateMatch.rawMaterial = new Types.ObjectId(aggregateMatch.rawMaterial);
    }

    const [movements, total, aggregates] = await Promise.all([
      WarehouseMovementModel.find(query)
        .sort({ date: -1 })
        .skip(skip)
        .limit(limit)
        .populate("rawMaterial", "name unit cost quantity")
        .populate("provider", "name")
        .populate("user", "name"),
      WarehouseMovementModel.countDocuments(query),
      WarehouseMovementModel.aggregate([
        { $match: aggregateMatch },
        {
          $group: {
            _id: {
              type: "$type",
              receptionPoint: { $ifNull: ["$receptionPoint", "__sin_bodega__"] },
            },
            totalValue: { $sum: "$totalValue" },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.receptionPoint": 1, "_id.type": 1 } },
      ]),
    ]);

    return res.status(200).send({
      movements,
      total,
      page,
      pages: Math.ceil(total / limit),
      aggregates,
    });
  } catch (error) {
    console.error("Error fetching warehouse movements:", error);
    next(error);
  }
}

// --- Create Batch ---
async function createBatch(req: IAuthRequest, res: Response, next: NextFunction) {
  try {
    const {
      type, date, responsible, observation, provider, invoiceRef, invoiceDueDate,
      receptionPoint, entity, user: bodyUser, items,
    } = req.body;
    const userId = req.user?.id || bodyUser;

    if (!userId) {
      return res.status(401).send({ message: "User authentication required." });
    }
    if (!type || !items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).send({ message: "Type and items are required." });
    }
    if (type === "IN" && (!invoiceRef || !invoiceDueDate)) {
      return res.status(400).send({ message: "invoiceRef and invoiceDueDate are required for IN movements." });
    }

    const batchId = randomUUID();
    const movementDocs: any[] = [];
    const materialUpdates: any[] = [];

    for (const item of items) {
      const { rawMaterial: rawMaterialId, quantity, unitCost, totalValue, receptionPoint: itemReceptionPoint, provider: itemProvider } = item;
      if (!rawMaterialId || !quantity || quantity <= 0) continue;

      const material = await RawMaterialModel.findById(rawMaterialId);
      if (!material) {
        return res.status(404).send({ message: `Raw Material ${rawMaterialId} not found.` });
      }

      const effectiveReceptionPoint = itemReceptionPoint || receptionPoint;
      const effectiveProvider = itemProvider || provider;
      let effectiveUnitCost = unitCost;
      let effectiveTotalValue = totalValue;

      if ((type === "OUT" || type === "LOSS") && effectiveUnitCost === undefined) {
        effectiveUnitCost = material.cost;
        effectiveTotalValue = quantity * material.cost;
      }

      if (type === "OUT" || type === "LOSS") {
        if (effectiveReceptionPoint) {
          const [locAgg] = await WarehouseMovementModel.aggregate([
            { $match: { rawMaterial: material._id, receptionPoint: effectiveReceptionPoint } },
            {
              $group: {
                _id: null,
                inQty:  { $sum: { $cond: [{ $eq: ["$type", "IN"] }, "$quantity", 0] } },
                outQty: { $sum: { $cond: [{ $in: ["$type", ["OUT", "LOSS"]] }, "$quantity", 0] } },
              },
            },
          ]);
          const locationQty = locAgg ? locAgg.inQty - locAgg.outQty : 0;
          if (locationQty < quantity) {
            return res.status(400).send({
              message: `Stock insuficiente en "${effectiveReceptionPoint}" para ${material.name}. Disponible: ${locationQty} ${material.unit}`,
            });
          }
        } else if (material.quantity < quantity) {
          return res.status(400).send({
            message: `Insufficient stock for ${material.name}. Available: ${material.quantity} ${material.unit}`,
          });
        }
        material.quantity -= quantity;
      } else if (type === "IN") {
        material.quantity += quantity;
      }

      const movement = new WarehouseMovementModel({
        type,
        rawMaterial: rawMaterialId,
        quantity,
        unitCost:       effectiveUnitCost   !== undefined ? Number(effectiveUnitCost)   : undefined,
        totalValue:     effectiveTotalValue !== undefined ? Number(effectiveTotalValue) : undefined,
        provider:       type === "IN"  ? effectiveProvider : undefined,
        entity:         type === "OUT" ? entity         : undefined,
        receptionPoint: effectiveReceptionPoint || undefined,
        user: userId,
        responsible,
        observation,
        date: date ? new Date(date) : new Date(),
        invoiceRef:     type === "IN" ? invoiceRef     : undefined,
        invoiceDueDate: type === "IN" ? invoiceDueDate : undefined,
        isPaid: false,
        batchId,
        expiryDate: type === "IN" && item.expiryDate ? new Date(item.expiryDate) : undefined,
      });

      movementDocs.push(movement);
      materialUpdates.push(material);
    }

    await Promise.all([
      ...movementDocs.map(m => m.save()),
      ...materialUpdates.map(m => m.save()),
    ]);

    return res.status(201).send({
      batchId,
      movements: movementDocs,
      count: movementDocs.length,
    });
  } catch (error) {
    console.error("Error creating batch warehouse movements:", error);
    next(error);
  }
}

// --- Get Invoices ---
async function getInvoices(req: Request, res: Response, next: NextFunction) {
  try {
    const { paid } = req.query;
    const matchStage: any = {
      type: "IN",
      invoiceRef: { $exists: true, $ne: null },
    };
    if (paid === "true") matchStage.isPaid = true;
    else if (paid === "false") matchStage.isPaid = false;

    const result = await WarehouseMovementModel.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: "$invoiceRef",
          invoiceDueDate: { $first: "$invoiceDueDate" },
          isPaid:         { $first: "$isPaid" },
          provider:       { $first: "$provider" },
          totalValue:     { $sum: "$totalValue" },
          count:          { $sum: 1 },
          rawMaterials:   { $addToSet: "$rawMaterial" },
          batchId:        { $first: "$batchId" },
        },
      },
      {
        $lookup: {
          from: "rawmaterials",
          localField: "rawMaterials",
          foreignField: "_id",
          as: "materialDocs",
        },
      },
      {
        $lookup: {
          from: "providers",
          localField: "provider",
          foreignField: "_id",
          as: "providerDocs",
        },
      },
      {
        $addFields: {
          materials: "$materialDocs.name",
          provider: { $arrayElemAt: ["$providerDocs", 0] },
        },
      },
      {
        $project: {
          rawMaterials: 0,
          materialDocs: 0,
          providerDocs: 0,
        },
      },
      { $sort: { invoiceDueDate: 1 } },
    ]);

    return res.status(200).send({ data: result });
  } catch (error) {
    console.error("Error fetching invoices:", error);
    next(error);
  }
}

// --- Mark Invoice Paid ---
async function markInvoicePaid(req: Request, res: Response, next: NextFunction) {
  try {
    const { invoiceRef } = req.params;
    const result = await WarehouseMovementModel.updateMany(
      { invoiceRef, type: "IN" },
      { $set: { isPaid: true } }
    );
    return res.status(200).send({ modifiedCount: result.modifiedCount });
  } catch (error) {
    console.error("Error marking invoice as paid:", error);
    next(error);
  }
}

export { createMovement, getMovements, getStockByLocation, createBatch, getInvoices, markInvoicePaid };
