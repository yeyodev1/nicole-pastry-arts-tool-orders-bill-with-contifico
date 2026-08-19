import express from "express";
import {
  getRawMaterials,
  createRawMaterial,
  updateRawMaterial,
  deleteRawMaterial
} from "../controllers/raw-material.controller";
import { getContificoStock } from "../controllers/raw-material-contifico.controller";

const router = express.Router();

router.get("/", getRawMaterials);
router.get("/:id/contifico-stock", getContificoStock);
router.post("/", createRawMaterial);
router.patch("/:id", updateRawMaterial);
router.delete("/:id", deleteRawMaterial);

export default router;
