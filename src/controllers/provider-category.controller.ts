import type { Request, Response, NextFunction } from "express";
import { HttpStatusCode } from "axios";
import { models } from "../models";

export async function getCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const categories = await models.providerCategories.find({ isActive: true }).sort({ name: 1 });
    res.status(HttpStatusCode.Ok).send({ message: "Categories retrieved.", data: categories });
  } catch (error) {
    next(error);
  }
}

export async function createCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const { name } = req.body;
    if (!name?.trim()) {
      res.status(HttpStatusCode.BadRequest).send({ message: "El nombre de la categoría es obligatorio." });
      return;
    }
    const existing = await models.providerCategories.findOne({ name: name.trim() });
    if (existing) {
      res.status(HttpStatusCode.Conflict).send({ message: "Ya existe una categoría con ese nombre." });
      return;
    }
    const category = new models.providerCategories({ name: name.trim() });
    await category.save();
    res.status(HttpStatusCode.Created).send({ message: "Categoría creada.", data: category });
  } catch (error) {
    next(error);
  }
}

export async function updateCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { name } = req.body;
    if (!name?.trim()) {
      res.status(HttpStatusCode.BadRequest).send({ message: "El nombre de la categoría es obligatorio." });
      return;
    }
    const category = await models.providerCategories.findById(id);
    if (!category) {
      res.status(HttpStatusCode.NotFound).send({ message: "Categoría no encontrada." });
      return;
    }
    const duplicate = await models.providerCategories.findOne({ name: name.trim(), _id: { $ne: id } });
    if (duplicate) {
      res.status(HttpStatusCode.Conflict).send({ message: "Ya existe una categoría con ese nombre." });
      return;
    }
    const oldName = category.name;
    category.name = name.trim();
    await category.save();
    // Keep raw materials in sync
    if (oldName !== name.trim()) {
      await models.rawMaterials.updateMany({ category: oldName }, { category: name.trim() });
    }
    res.status(HttpStatusCode.Ok).send({ message: "Categoría actualizada.", data: category });
  } catch (error) {
    next(error);
  }
}

export async function deleteCategory(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { targetCategory } = req.body;

    const category = await models.providerCategories.findById(id);
    if (!category) {
      res.status(HttpStatusCode.NotFound).send({ message: "Categoría no encontrada." });
      return;
    }

    const affectedCount = await models.rawMaterials.countDocuments({ category: category.name });

    if (affectedCount > 0 && !targetCategory) {
      res.status(HttpStatusCode.BadRequest).send({
        message: `Esta categoría tiene ${affectedCount} ítem(s) asignado(s). Debe seleccionar una categoría de destino para reasignarlos antes de eliminarla.`,
        affectedCount
      });
      return;
    }

    if (affectedCount > 0 && targetCategory) {
      await models.rawMaterials.updateMany({ category: category.name }, { category: targetCategory });
    }

    await models.providerCategories.findByIdAndDelete(id);
    res.status(HttpStatusCode.Ok).send({ message: "Categoría eliminada.", reassigned: affectedCount });
  } catch (error) {
    next(error);
  }
}
