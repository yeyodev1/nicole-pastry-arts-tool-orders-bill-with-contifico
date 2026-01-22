import { Router } from "express";
import { getProductionTasks, updateProductionTask, getItemsSummary, batchUpdateProductionTasks, registerProgress, updateItemStatus } from "../controllers/production.controller";

const productionRouter = Router();

productionRouter.get("/", getProductionTasks);
productionRouter.get("/summary", getItemsSummary);
productionRouter.patch("/batch", batchUpdateProductionTasks);
productionRouter.post("/progress", registerProgress); // NEW: Register Partial Progress
productionRouter.patch("/:id/product-status", updateItemStatus); // NEW: Update specific product status
productionRouter.patch("/:id", updateProductionTask);

export default productionRouter;
