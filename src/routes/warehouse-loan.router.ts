import { Router } from "express";
import * as LoanController from "../controllers/warehouse-loan.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = Router();

router.use(authMiddleware);

router.post("/", LoanController.createLoan);
router.get("/", LoanController.getLoans);
router.put("/:id/return", LoanController.returnLoan);
router.put("/:id/write-off", LoanController.writeOffLoan);

export default router;
