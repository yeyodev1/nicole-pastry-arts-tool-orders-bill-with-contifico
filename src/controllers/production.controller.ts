
import type { Request, Response } from "express";
import { HttpStatusCode } from "axios";
import { ProductionService } from "../services/production.service";

const productionService = new ProductionService();

/**
 * Get all production tasks (To-Do List)
 * Syncs with Contífico first to ensure data is up to date (Yesterday -> Future).
 */
export async function getProductionTasks(req: Request, res: Response) {
  try {
    const tasks = await productionService.getProductionTasks();

    res.status(HttpStatusCode.Ok).send({
      message: "Production tasks retrieved successfully.",
      count: tasks.length,
      data: tasks
    });
  } catch (error: any) {
    console.error("❌ Error retrieving production tasks:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Failed to retrieve production tasks.",
      error: error.message
    });
  }
}

/**
 * Update a production task (Stage or Notes)
 */
export async function updateProductionTask(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { stage, notes } = req.body;

    if (!stage && notes === undefined) {
      res.status(HttpStatusCode.BadRequest).send({
        message: "At least one field (stage or notes) is required to update."
      });
      return;
    }

    if (stage && !["PENDING", "IN_PROCESS", "FINISHED"].includes(stage)) {
      res.status(HttpStatusCode.BadRequest).send({
        message: "Invalid stage value."
      });
      return;
    }

    const updatedTask = await productionService.updateTask(id, { stage, notes });

    if (!updatedTask) {
      res.status(HttpStatusCode.NotFound).send({
        message: "Production task not found."
      });
      return;
    }

    res.status(HttpStatusCode.Ok).send({
      message: "Production task updated successfully.",
      data: updatedTask
    });
  } catch (error: any) {
    console.error("❌ Error updating production task:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Failed to update production task.",
      error: error.message
    });
  }
}
