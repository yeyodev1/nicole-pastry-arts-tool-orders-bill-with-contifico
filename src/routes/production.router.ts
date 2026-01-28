import { Router } from "express";
import { getProductionTasks, updateProductionTask, getItemsSummary, batchUpdateProductionTasks, registerProgress, updateItemStatus, getAllProductionOrders, registerDispatchOrder, editDispatchOrder, getProductionReports, batchRegisterDispatchOrder, registerDispatchProgress } from "../controllers/production.controller";

const productionRouter = Router();

productionRouter.get("/", getProductionTasks);
productionRouter.post("/dispatch/progress", registerDispatchProgress); // New item-based dispatch endpoint
productionRouter.post("/dispatch/batch", batchRegisterDispatchOrder); // New batch endpoint
productionRouter.get("/reports", getProductionReports); // New reports endpoint
productionRouter.get("/all-orders", getAllProductionOrders);
productionRouter.get("/summary", getItemsSummary);
productionRouter.patch("/batch", batchUpdateProductionTasks);
productionRouter.post("/progress", registerProgress);
productionRouter.patch("/:id/product-status", updateItemStatus);
productionRouter.patch("/:id", updateProductionTask);

// Dispatch Routes
productionRouter.post("/:id/dispatch", registerDispatchOrder);
productionRouter.put("/:id/dispatch/:dispatchId", editDispatchOrder);

export default productionRouter;
