import { Router } from "express";
import * as WarehouseController from "../controllers/warehouse.controller";
import * as WarehouseReportsController from "../controllers/warehouse-reports.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = Router();

// router.use(authMiddleware);

router.post("/", authMiddleware, WarehouseController.createMovement);
router.get("/", WarehouseController.getMovements);
router.get("/stock-by-location/:rawMaterialId", authMiddleware, WarehouseController.getStockByLocation);
router.post('/batch', authMiddleware, WarehouseController.createBatch);
router.get('/invoices', authMiddleware, WarehouseController.getInvoices);
router.patch('/invoices/:invoiceRef/pay', authMiddleware, WarehouseController.markInvoicePaid);
router.get('/expiring', authMiddleware, WarehouseReportsController.getExpiring);
router.get('/dispatch-summary', authMiddleware, WarehouseReportsController.getDispatchSummary);

export { router as WarehouseRouter };
