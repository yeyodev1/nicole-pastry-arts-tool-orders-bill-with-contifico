import { Router } from "express";
import * as WarehouseController from "../controllers/warehouse.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = Router();

// router.use(authMiddleware);

router.post("/", authMiddleware, WarehouseController.createMovement);
router.get("/", WarehouseController.getMovements);
router.get("/stock-by-location/:rawMaterialId", authMiddleware, WarehouseController.getStockByLocation);
router.post('/batch', authMiddleware, WarehouseController.createBatch);
router.get('/invoices', authMiddleware, WarehouseController.getInvoices);
router.patch('/invoices/:invoiceRef/pay', authMiddleware, WarehouseController.markInvoicePaid);

export { router as WarehouseRouter };
