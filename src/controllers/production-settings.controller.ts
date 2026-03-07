import type { Response, NextFunction } from "express";
import { models } from "../models";
import { AuthRequest } from "../types/AuthRequest";

export async function getProductionSettings(
  _req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const settings = await models.productionSettings.findOne({ key: "global" });

    res.status(200).send({
      message: "Production settings retrieved successfully.",
      data: {
        destinations: settings?.destinations ?? []
      },
    });
    return;
  } catch (error) {
    next(error);
  }
}

export async function updateProductionSettings(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { destinations } = req.body;

    if (!Array.isArray(destinations)) {
      res.status(400).send({ message: "Destinations must be an array." });
      return;
    }

    // Validate destinations structure
    const sanitizedDestinations = destinations
      .filter((d: any) => typeof d.name === 'string' && typeof d.icon === 'string')
      .map((d: any) => ({
        id: d.id || `dest-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        name: d.name,
        icon: d.icon,
        matchKeywords: Array.isArray(d.matchKeywords)
          ? d.matchKeywords.filter((k: any) => typeof k === 'string').map((k: string) => k.toLowerCase())
          : []
      }));

    // Allow saving empty destinations to support clearing configuration


    const updated = await models.productionSettings.findOneAndUpdate(
      { key: "global" },
      { destinations: sanitizedDestinations },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).send({
      message: "Production settings updated successfully.",
      data: {
        destinations: updated.destinations
      },
    });
    return;
  } catch (error) {
    next(error);
  }
}
