import { Request } from "express";

export interface JwtPayload {
  id: string;
  email: string;
  name: string;
  role: string;
  contificoSource?: string;
  iat?: number;
  exp?: number;
}

export interface AuthRequest extends Request {
  user?: JwtPayload;
}
