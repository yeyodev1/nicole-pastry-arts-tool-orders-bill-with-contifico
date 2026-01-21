
import { Router } from "express";
import { getProductionTasks, updateProductionTask } from "../controllers/production.controller";

const productionRouter = Router();

productionRouter.get("/", getProductionTasks);
productionRouter.patch("/:id", updateProductionTask);

export default productionRouter;
