import express from "express";
import * as PersonController from "../controllers/person.controller";

const router = express.Router();

// GET /api/persons
router.get("/", PersonController.getPerson);

// POST /api/persons
router.post("/", PersonController.createPerson);

export default router;
