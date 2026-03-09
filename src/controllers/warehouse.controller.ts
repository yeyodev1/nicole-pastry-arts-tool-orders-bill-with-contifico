import type { Request, Response, NextFunction } from "express";
import { WarehouseMovementModel } from "../models/warehouse-movement.model";
import { RawMaterialModel } from "../models/raw-material.model";
import { Types } from "mongoose";

interface IAuthRequest extends Request {
  user?: any;
}

// --- Create Movement ---
async function createMovement(req: IAuthRequest, res: Response, next: NextFunction) {
  try {
    const {
      type, rawMaterial, quantity, provider, entity, observation,
      unitCost, totalValue, responsible, receptionPoint,
    } = req.body;
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

export { createMovement, getMovements, getStockByLocation };
