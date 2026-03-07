import express from "express";
import { getGoalSettings, updateGoalSettings } from "../controllers/goal-settings.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();

router.use(authMiddleware);
router.get("/", getGoalSettings);
router.put("/", updateGoalSettings);

export default router;
