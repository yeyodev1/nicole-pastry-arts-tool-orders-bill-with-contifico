import { Router } from "express";
import {
  getBranches,
  createBranch,
  updateBranch,
  deleteBranch,
} from "../controllers/branch.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const branchRouter = Router();

branchRouter.use(authMiddleware);

branchRouter.get("/", getBranches);
branchRouter.post("/", createBranch);
branchRouter.put("/:id", updateBranch);
branchRouter.delete("/:id", deleteBranch);

export default branchRouter;
