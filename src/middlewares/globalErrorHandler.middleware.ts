import type { NextFunction, Request, Response } from "express";

export function globalErrorHandler(
  error: any,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const status = error.status || 500;
  const message = error.message || "Internal server error";

  console.error("Global Error Handler:", error);

  res.status(status).send({
    message,
  });
}
