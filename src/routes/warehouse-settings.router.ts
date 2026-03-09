import { Router } from "express";
import {
  getWarehouseSettings,
  updateWarehouseSettings,
} from "../controllers/warehouse-settings.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const warehouseSettingsRouter = Router();

warehouseSettingsRouter.use(authMiddleware);

warehouseSettingsRouter.get("/", getWarehouseSettings);
warehouseSettingsRouter.put("/", updateWarehouseSettings);

export default warehouseSettingsRouter;
