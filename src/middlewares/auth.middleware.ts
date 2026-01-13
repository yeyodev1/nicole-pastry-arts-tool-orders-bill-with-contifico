import { Response, NextFunction, Request } from "express";
import jwt from "jsonwebtoken";
import { HttpStatusCode } from "axios";
import { AuthRequest, JwtPayload } from "../types/AuthRequest";

export function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res
      .status(HttpStatusCode.Unauthorized)
      .send({
        message: "Acceso denegado. Se requiere token de autenticación.",
      });
    return;
  }

  const token = authHeader.split(" ")[1];
  try {
    const decodedPayload = jwt.verify(
      token,
      process.env.JWT_SECRET || "SUPER_SECRET_KEY",
    ) as JwtPayload;
    req.user = decodedPayload;
    next();
  } catch (error) {
    console.error("¡ERROR EN EL MIDDLEWARE!", error);
    res
      .status(HttpStatusCode.Unauthorized)
      .send({ message: "Token inválido o expirado." });
    return;
  }
}
