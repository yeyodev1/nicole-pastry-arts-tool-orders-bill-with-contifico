
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

export async function getAllProductionOrders(req: Request, res: Response) {
  try {
    const orders = await productionService.getAllOrders();
    res.status(HttpStatusCode.Ok).send({
      message: "All production orders retrieved successfully.",
      count: orders.length,
      data: orders
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
    const dashboard = await productionService.getAggregatedItems();
    res.status(HttpStatusCode.Ok).send({ message: "Dashboard retrieved", dashboard });
  } catch (error: any) {
    res.status(HttpStatusCode.InternalServerError).send({ message: "Failed", error: error.message });
  }
}

export async function registerDispatchOrder(req: Request, res: Response) {
  try {
    const { id } = req.params;
    // Body: { destination, items, notes, reportedBy }
    const result = await productionService.registerDispatch(id, req.body);
    res.status(HttpStatusCode.Ok).send({ message: "Dispatch reported successfully.", data: result });
  } catch (error: any) {
    res.status(HttpStatusCode.InternalServerError).send({ message: "Failed", error: error.message });
  }
}

export async function getProductionReports(req: Request, res: Response) {
  try {
    const range = (req.query.range as 'today' | 'week') || 'today';
    const stats = await productionService.getReportsStats(range);
    res.status(HttpStatusCode.Ok).send({ message: "Reports generated successfully.", data: stats });
  } catch (error: any) {
    res.status(HttpStatusCode.InternalServerError).send({ message: "Failed", error: error.message });
  }
}

export async function batchRegisterDispatchOrder(req: Request, res: Response) {
  try {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return res.status(HttpStatusCode.BadRequest).send({ message: "No IDs provided" });
    }

    // In a real app, 'reportedBy' would come from auth token user
    const result = await productionService.batchRegisterDispatch(ids, "Producción (Masivo)");

    res.status(HttpStatusCode.Ok).send({
      message: `Batch dispatch processed. Success: ${result.success}, Failed: ${result.failed}`,
      data: result
    });
  } catch (error: any) {
    res.status(HttpStatusCode.InternalServerError).send({ message: "Batch dispatch failed", error: error.message });
  }
}

export async function registerDispatchProgress(req: Request, res: Response) {
  try {
    const { destination, items } = req.body;

    if (!destination || !items || !Array.isArray(items)) {
      return res.status(HttpStatusCode.BadRequest).send({ message: "Invalid payload. Destination and items array required." });
    }

    const result = await productionService.registerDispatchProgress(destination, items);

    res.status(HttpStatusCode.Ok).send({
      message: "Dispatch progress registered",
      data: result
    });
  } catch (error: any) {
    res.status(HttpStatusCode.InternalServerError).send({ message: "Error registering dispatch progress", error: error.message });
  }
}

export async function editDispatchOrder(req: Request, res: Response) {
  try {
    const { id, dispatchId } = req.params;
    // Body: { items, notes }
    const result = await productionService.updateDispatch(id, dispatchId, req.body);
    res.status(HttpStatusCode.Ok).send({ message: "Dispatch updated successfully.", data: result });
  } catch (error: any) {
    const status = error.message.includes("Edit window") ? HttpStatusCode.Forbidden : HttpStatusCode.InternalServerError;
    res.status(status).send({ message: "Failed", error: error.message });
  }
}

export async function updateItemStatus(req: Request, res: Response) {
  try {
    const { id } = req.params;
    const { productName, status, notes } = req.body;

    if (!productName || !status) {
      res.status(HttpStatusCode.BadRequest).send({ message: "Product Name and Status are required." });
      return;
    }

    const result = await productionService.updateProductStatus(id, productName, status, notes);

    if (!result) {
      res.status(HttpStatusCode.NotFound).send({ message: "Order or Product not found" });
      return;
    }

    res.status(HttpStatusCode.Ok).send({ message: "Product status updated", data: result });
  } catch (error: any) {
    res.status(HttpStatusCode.InternalServerError).send({ message: "Failed", error: error.message });
  }
}

export async function registerProgress(req: Request, res: Response) {
  try {
    const { productName, quantity } = req.body;

    if (!productName || typeof quantity !== 'number' || quantity <= 0) {
      res.status(HttpStatusCode.BadRequest).send({ message: "Invalid product or quantity." });
      return;
    }

    const result = await productionService.registerProductionProgress(productName, quantity);

    res.status(HttpStatusCode.Ok).send({
      message: "Progress registered successfully.",
      data: result
    });
  } catch (error: any) {
    console.error("Progress register error:", error);
    res.status(HttpStatusCode.InternalServerError).send({ message: "Failed", error: error.message });
  }
}
