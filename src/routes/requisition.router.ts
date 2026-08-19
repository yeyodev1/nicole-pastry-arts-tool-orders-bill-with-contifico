import { Router } from "express";
import * as RequisitionController from "../controllers/requisition.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = Router();

router.use(authMiddleware);

router.post("/", RequisitionController.createRequisition);
router.get("/", RequisitionController.getRequisitions);
router.get("/pending-count", RequisitionController.getPendingCount);
router.put("/:id/status", RequisitionController.updateStatus);
router.put("/:id/dispatch", RequisitionController.dispatchRequisition);
router.put("/:id/confirm", RequisitionController.confirmRequisition);

export default router;
