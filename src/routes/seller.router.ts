import { Router } from "express";
import {
  getSellers,
  createSeller,
  updateSeller,
  deactivateSeller,
} from "../controllers/seller.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const sellerRouter = Router();

sellerRouter.use(authMiddleware);

sellerRouter.get("/", getSellers);
sellerRouter.post("/", createSeller);
sellerRouter.put("/:id", updateSeller);
sellerRouter.delete("/:id", deactivateSeller);

export default sellerRouter;
