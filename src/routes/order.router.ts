import express from "express";
import * as OrderController from "../controllers/order.controller";

const router = express.Router();

// POST /api/orders
router.post("/", OrderController.createOrder);

export default router;
