import express from "express";
import {
  getProviders,
  getProviderById,
  createProvider,
  updateProvider,
  deleteProvider
} from "../controllers/provider.controller";

const router = express.Router();

router.get("/", getProviders);
router.get("/:id", getProviderById);
router.post("/", createProvider);
router.patch("/:id", updateProvider);
router.delete("/:id", deleteProvider);

export default router;
