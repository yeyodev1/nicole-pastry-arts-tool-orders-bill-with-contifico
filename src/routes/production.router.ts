import { Router } from "express";
import { getProductionTasks, updateProductionTask, getItemsSummary, batchUpdateProductionTasks } from "../controllers/production.controller";

const productionRouter = Router();

productionRouter.get("/", getProductionTasks);
productionRouter.get("/summary", getItemsSummary); // Get Aggregated
productionRouter.patch("/batch", batchUpdateProductionTasks); // NEW: Batch Update
productionRouter.patch("/:id", updateProductionTask);

export default productionRouter;
