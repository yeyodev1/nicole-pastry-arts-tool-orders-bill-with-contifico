import type { Request, Response, NextFunction } from "express";
import { UserService } from "../services/user.service";

const userService = new UserService();

export const createUser = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const user = await userService.createUser(req.body);
    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
};

export const getAllUsers = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const users = await userService.findAll();
    res.status(200).json(users);
  } catch (error) {
    next(error);
  }
};

export const login = async (
  req: Request,
  res: Response,
  next: NextFunction
) => {
  try {
    const response = await userService.loginUser(req.body);
    res.status(200).json(response);
  } catch (error) {
    if (error instanceof Error && (error.message === "USER_NOT_FOUND" || error.message === "PASSWORD_INCORRECT")) {
      res.status(401).send(error.message);
    } else {
      next(error);
    }
  }
};
