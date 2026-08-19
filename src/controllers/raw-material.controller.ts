import type { Request, Response, NextFunction } from "express";
import { HttpStatusCode } from "axios";
import { models } from "../models";
import { WarehouseMovementModel } from "../models/warehouse-movement.model";
import { Types } from "mongoose";

export async function getRawMaterials(req: Request, res: Response, next: NextFunction) {
  try {
    let query: any = {};
    const { search, provider, category, receptionPoint } = req.query;

    if (search) {
      const searchRegex = new RegExp(String(search), 'i');
      query.$or = [
        { name: searchRegex },
        { code: searchRegex },
        { item: searchRegex }
      ];
    }

    if (provider) {
      // Filtra materiales que tienen este proveedor en el array providers[] O en el campo legacy provider
      query.$or = [
        { provider: new Types.ObjectId(String(provider)) },
        { 'providers.provider': new Types.ObjectId(String(provider)) }
      ];
    }
    if (category) query.category = String(category);

    // Initial fetch of materials based on base filters
    let materials: any[] = await models.rawMaterials.find(query)
      .populate('provider')
      .populate('providers.provider')
      .sort({ name: 1 })
      .lean();

    // If receptionPoint is provided, filter materials by calculating local stock
    if (receptionPoint) {
      const materialIds = materials.map(m => new Types.ObjectId(m._id as string));

      // Calculate stock for the specified reception point
      const stockAgg = await WarehouseMovementModel.aggregate([
        {
          $match: {
            rawMaterial: { $in: materialIds },
            receptionPoint: String(receptionPoint)
          }
        },
        {
          $group: {
            _id: "$rawMaterial",
            inQty: { $sum: { $cond: [{ $eq: ["$type", "IN"] }, "$quantity", 0] } },
            outQty: { $sum: { $cond: [{ $in: ["$type", ["OUT", "LOSS"]] }, "$quantity", 0] } }
          }
        }
      ]);

      const stockMap = new Map();
      stockAgg.forEach(item => {
        stockMap.set(item._id.toString(), item.inQty - item.outQty);
      });

      // Update material quantities to reflect only the stock at the point
      materials = materials.map(m => {
        const localStock = stockMap.get(m._id.toString()) || 0;
        return {
          ...m,
          quantity: localStock // Override global quantity with local stock
        };
      });
    }

    res.status(HttpStatusCode.Ok).send({
      message: "Raw materials retrieved successfully.",
      data: materials
    });
    return;
  } catch (error) {
    console.error("❌ Error in getRawMaterials:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Error fetching raw materials.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

function syncProviderAndCost(materialData: any) {
  if (materialData.providers && Array.isArray(materialData.providers)) {
    const main = materialData.providers.find((p: any) => p.isMain);
    if (main) {
      materialData.provider = main.provider;
      materialData.cost = main.price;
    }
  }
  return materialData;
}

export async function createRawMaterial(req: Request, res: Response, next: NextFunction) {
  try {
    let materialData = req.body;

    if (!materialData.name || !materialData.unit) {
      res.status(HttpStatusCode.BadRequest).send({
        message: "Name and Unit are required."
      });
      return;
    }

    const existing = await models.rawMaterials.findOne({ name: materialData.name });
    if (existing) {
      res.status(HttpStatusCode.Conflict).send({
        message: "A raw material with this name already exists."
      });
      return;
    }

    materialData = syncProviderAndCost(materialData);

    const newMaterial = new models.rawMaterials(materialData);
    await newMaterial.save();

    res.status(HttpStatusCode.Created).send({
      message: "Raw material created successfully.",
      data: newMaterial
    });
    return;
  } catch (error) {
    console.error("❌ Error in createRawMaterial:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Error creating raw material.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

export async function updateRawMaterial(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    let updateData = req.body;

    updateData = syncProviderAndCost(updateData);

    const material = await models.rawMaterials.findByIdAndUpdate(id, updateData, { new: true });
    if (!material) {
      res.status(HttpStatusCode.NotFound).send({ message: "Raw material not found." });
      return;
    }

    res.status(HttpStatusCode.Ok).send({
      message: "Raw material updated successfully.",
      data: material
    });
    return;
  } catch (error) {
    console.error("❌ Error in updateRawMaterial:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Error updating raw material.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

export async function deleteRawMaterial(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;

    const material = await models.rawMaterials.findByIdAndDelete(id);
    if (!material) {
      res.status(HttpStatusCode.NotFound).send({ message: "Raw material not found." });
      return;
    }

    res.status(HttpStatusCode.Ok).send({
      message: "Raw material deleted successfully."
    });
    return;
  } catch (error) {
    console.error("❌ Error in deleteRawMaterial:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Error deleting raw material.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}
