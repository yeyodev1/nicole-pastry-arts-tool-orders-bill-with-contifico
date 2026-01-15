import express from "express";
import * as OrderController from "../controllers/order.controller";

const router = express.Router();

// POST /api/orders
router.post("/", OrderController.createOrder);

// POST /api/orders/batch-invoice (Protected by Cron)
router.post("/batch-invoice", OrderController.processPendingInvoices);

export default router;
