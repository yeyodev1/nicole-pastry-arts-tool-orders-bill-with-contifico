import type { Response, NextFunction } from "express";
import { models } from "../models";
import { AuthRequest } from "../types/AuthRequest";

export async function getWarehouseSettings(
  _req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const settings = await models.warehouseSettings.findOne({ key: "global" });

    res.status(200).send({
      message: "Warehouse settings retrieved successfully.",
      data: {
        receptionPoints: settings?.receptionPoints ?? [],
        dispatchPoints: settings?.dispatchPoints ?? [],
      },
    });
  } catch (error) {
    next(error);
  }
}

export async function updateWarehouseSettings(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { receptionPoints, dispatchPoints } = req.body;

    if (!Array.isArray(receptionPoints) || !Array.isArray(dispatchPoints)) {
      res.status(400).send({ message: "receptionPoints and dispatchPoints must be arrays." });
      return;
    }

    const sanitizePoints = (arr: any[]) =>
      arr
        .filter((p: any) => typeof p.name === "string" && p.name.trim())
        .map((p: any) => ({
          ...(p._id ? { _id: p._id } : {}),
          name: p.name.trim(),
          isActive: p.isActive !== false,
        }));

    const updated = await models.warehouseSettings.findOneAndUpdate(
      { key: "global" },
      {
        receptionPoints: sanitizePoints(receptionPoints),
        dispatchPoints: sanitizePoints(dispatchPoints),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).send({
      message: "Warehouse settings updated successfully.",
      data: {
        receptionPoints: updated.receptionPoints,
        dispatchPoints: updated.dispatchPoints,
      },
    });
  } catch (error) {
    next(error);
  }
}
