import express from "express";
import * as AnalyticsController from "../controllers/analytics.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();

// GET /api/analytics/dashboard (Fast, cached)
router.get("/dashboard", AnalyticsController.getDashboardStats);

// POST /api/analytics/sync (Slow, fetches from external API)
router.post("/sync", AnalyticsController.syncAnalytics);

// GET /api/analytics/sales-by-responsible
router.get("/sales-by-responsible", authMiddleware as any, AnalyticsController.getSalesByResponsible);

export default router;
