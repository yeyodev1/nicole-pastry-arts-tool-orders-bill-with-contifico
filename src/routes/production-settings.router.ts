import { Router } from "express";
import { getProductionSettings, updateProductionSettings } from "../controllers/production-settings.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const productionSettingsRouter = Router();

// Apply auth middleware to all settings routes
productionSettingsRouter.use(authMiddleware);

productionSettingsRouter.get("/", getProductionSettings);
productionSettingsRouter.put("/", updateProductionSettings);

export default productionSettingsRouter;
