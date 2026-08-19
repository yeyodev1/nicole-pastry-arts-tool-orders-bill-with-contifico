import express from "express";
import { createUser, getAllUsers, login, updateUser, deleteUser, forgotPassword, resetPassword } from "../controllers/user.controller";
import { authMiddleware } from "../middlewares/auth.middleware";

const router = express.Router();

router.post("/login", login);
router.post("/forgot-password", forgotPassword);
router.post("/reset-password", resetPassword);

// Protected routes
router.use(authMiddleware);
router.post("/", createUser);
router.get("/", getAllUsers);
router.put("/:id", updateUser);
router.delete("/:id", deleteUser);

export default router;
