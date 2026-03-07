import type { Request, Response, NextFunction } from "express";
import { HttpStatusCode } from "axios";
import { models } from "../models";

export async function getRawMaterials(req: Request, res: Response, next: NextFunction) {
  try {
    let query: any = {};
    const { search, provider, category } = req.query;

    if (search) {
      const searchRegex = new RegExp(String(search), 'i');
      query.$or = [
        { name: searchRegex },
        { code: searchRegex },
        { item: searchRegex }
      ];
    }

    if (provider) query.provider = provider;
    if (category) query.category = String(category);

    const materials = await models.rawMaterials.find(query).populate('provider').sort({ name: 1 });
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

export async function createRawMaterial(req: Request, res: Response, next: NextFunction) {
  try {
    const materialData = req.body;

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
    const updateData = req.body;

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
