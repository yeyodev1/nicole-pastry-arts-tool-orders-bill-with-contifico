
import type { Request, Response } from "express";
import { HttpStatusCode } from "axios";
import { ProductionService } from "../services/production.service";

const productionService = new ProductionService();

export async function getProductionTasks(req: Request, res: Response) {
  try {
    const tasks = await productionService.getProductionTasks();
    res.status(HttpStatusCode.Ok).send({
      message: "Production tasks retrieved successfully.",
      count: tasks.length,
      data: tasks
    });
  } catch (error: any) {
    res.status(HttpStatusCode.InternalServerError).send({ message: "Failed", error: error.message });
  }
}

export async function updateProductionTask(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { stage, notes } = req.body;
    const updatedTask = await productionService.updateTask(id, { stage, notes });
    if (!updatedTask) {
      res.status(HttpStatusCode.NotFound).send({ message: "Not found" });
      return;
    }
    res.status(HttpStatusCode.Ok).send({ message: "Updated", data: updatedTask });
  } catch (error: any) {
    res.status(HttpStatusCode.InternalServerError).send({ message: "Failed", error: error.message });
  }
}

export async function batchUpdateProductionTasks(req: Request, res: Response) {
  try {
    const { ids, stage } = req.body; // ids: string[], stage: string
    if (!ids || !Array.isArray(ids) || ids.length === 0 || !stage) {
      res.status(HttpStatusCode.BadRequest).send({ message: "Invalid batch update request." });
      return;
    }

    await productionService.batchUpdateTasks(ids, { stage });
    res.status(HttpStatusCode.Ok).send({ message: "Batch update successful." });
  } catch (error: any) {
    console.error("Batch update error:", error);
    res.status(HttpStatusCode.InternalServerError).send({ message: "Failed", error: error.message });
  }
}

export async function getItemsSummary(req: Request, res: Response) {
  try {
    const summary = await productionService.getAggregatedItems();
    res.status(HttpStatusCode.Ok).send({ message: "Summary retrieved", summary });
  } catch (error: any) {
    res.status(HttpStatusCode.InternalServerError).send({ message: "Failed", error: error.message });
  }
}
