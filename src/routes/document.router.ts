import express from "express";
import * as DocumentController from "../controllers/document.controller";

const router = express.Router();

// GET /api/documents
router.get("/", DocumentController.getDocuments);

export default router;
