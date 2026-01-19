import express from "express";
import * as OrderController from "../controllers/order.controller";

const router = express.Router();

// POST /api/orders
router.post("/", OrderController.createOrder);

// GET /api/orders
router.get("/", OrderController.getOrders);

// GET /api/orders/:id
router.get("/:id", OrderController.getOrderById);

// POST /api/orders/batch-invoice (Protected by Cron)
router.post("/batch-invoice", OrderController.processPendingInvoices);

// PUT /api/orders/:id/invoice
router.put("/:id/invoice", OrderController.updateInvoiceData);

export default router;
