import express from "express";
import { createUser, getAllUsers, login } from "../controllers/user.controller";

const router = express.Router();

router.post("/login", login);
router.post("/", createUser);
router.get("/", getAllUsers);

export default router;
