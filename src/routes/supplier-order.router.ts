import { Router } from "express";
import * as SupplierOrderController from "../controllers/supplier-order.controller";

const router = Router();

router.post("/", SupplierOrderController.createOrder);
router.get("/", SupplierOrderController.getOrders);
router.get("/arriving-today", SupplierOrderController.getArrivingToday);
router.get("/:id", SupplierOrderController.getOrderById);
router.put("/:id", SupplierOrderController.updateOrder);
router.put("/:id/receive", SupplierOrderController.receiveOrder);
router.delete("/:id", SupplierOrderController.deleteOrder);

export default router;
