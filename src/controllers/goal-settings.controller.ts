import type { Response, NextFunction } from "express";
import { models } from "../models";
import { AuthRequest } from "../types/AuthRequest";

const DEFAULT_MANAGER_GOAL = 7000;
const DEFAULT_SELLER_GOAL = 10000;

export async function getGoalSettings(
  _req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const settings = await models.goalSettings.findOne({ key: "global" });

    // Convert Mongoose Map to a plain object for the response
    const individualGoals = settings?.individualGoals
      ? Object.fromEntries(settings.individualGoals)
      : {};

    const commissionTiers = settings?.commissionTiers ?? [
      { threshold: 0, rate: 2 },
      { threshold: 10000, rate: 3 },
      { threshold: 13000, rate: 6 }
    ];

    res.status(200).send({
      message: "Goal settings retrieved successfully.",
      data: {
        managerGoal: settings?.managerGoal ?? DEFAULT_MANAGER_GOAL,
        sellerGoal: settings?.sellerGoal ?? DEFAULT_SELLER_GOAL,
        individualGoals,
        commissionTiers,
      },
    });
    return;
  } catch (error) {
    next(error);
  }
}

export async function updateGoalSettings(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { managerGoal, sellerGoal, individualGoals, commissionTiers } = req.body;

    if (typeof managerGoal !== "number" || typeof sellerGoal !== "number") {
      res.status(400).send({ message: "managerGoal and sellerGoal must be numbers." });
      return;
    }

    if (managerGoal < 0 || sellerGoal < 0) {
      res.status(400).send({ message: "Goals must be non-negative." });
      return;
    }

    // Validate individualGoals — must be a plain object with numeric values
    const sanitizedIndividualGoals: Record<string, number> = {};
    if (individualGoals && typeof individualGoals === "object") {
      for (const [name, value] of Object.entries(individualGoals)) {
        if (typeof value === "number" && value >= 0) {
          sanitizedIndividualGoals[name] = value;
        }
      }
    }

    let sanitizedTiers = [
      { threshold: 0, rate: 2 },
      { threshold: 10000, rate: 3 },
      { threshold: 13000, rate: 6 }
    ];
    if (Array.isArray(commissionTiers)) {
      sanitizedTiers = commissionTiers
        .filter((t: any) => typeof t.threshold === 'number' && typeof t.rate === 'number' && t.threshold >= 0 && t.rate >= 0)
        .map((t: any) => ({ threshold: t.threshold, rate: t.rate }))
        .sort((a, b) => a.threshold - b.threshold);

      if (sanitizedTiers.length === 0) {
        res.status(400).send({ message: "At least one valid commission tier is required." });
        return;
      }
    }

    const updated = await models.goalSettings.findOneAndUpdate(
      { key: "global" },
      {
        managerGoal,
        sellerGoal,
        individualGoals: sanitizedIndividualGoals,
        commissionTiers: sanitizedTiers,
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    res.status(200).send({
      message: "Goal settings updated successfully.",
      data: {
        managerGoal: updated.managerGoal,
        sellerGoal: updated.sellerGoal,
        individualGoals: Object.fromEntries(updated.individualGoals),
        commissionTiers: updated.commissionTiers,
      },
    });
    return;
  } catch (error) {
    next(error);
  }
}
