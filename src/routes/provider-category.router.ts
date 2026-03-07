import express from "express";
import { getCategories, createCategory, updateCategory, deleteCategory } from "../controllers/provider-category.controller";

const router = express.Router();

router.get("/", getCategories);
router.post("/", createCategory);
router.patch("/:id", updateCategory);
router.delete("/:id", deleteCategory);

export default router;
