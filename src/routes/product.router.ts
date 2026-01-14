import express from "express";
import * as ProductController from "../controllers/product.controller";

const router = express.Router();

// GET /api/products
router.get("/", ProductController.getProducts);

export default router;
