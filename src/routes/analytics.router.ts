import express from "express";
import * as AnalyticsController from "../controllers/analytics.controller";

const router = express.Router();

// GET /api/analytics/dashboard (Fast, cached)
router.get("/dashboard", AnalyticsController.getDashboardStats);

// POST /api/analytics/sync (Slow, fetches from external API)
router.post("/sync", AnalyticsController.syncAnalytics);

export default router;
