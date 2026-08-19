import { Router } from "express";
import { getPayables } from "../controllers/payables.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = Router();

router.use(authMiddleware);
router.get("/", getPayables);

export default router;
