import type { Request, Response, NextFunction } from "express";
import { UserService } from "../services/user.service";

const userService = new UserService();

export async function createUser(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const user = await userService.createUser(req.body);
    res.status(201).send(user);
    return;
  } catch (error) {
    next(error);
  }
}

export async function getAllUsers(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const users = await userService.findAll();
    res.status(200).send(users);
    return;
  } catch (error) {
    next(error);
  }
}

export async function login(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const response = await userService.loginUser(req.body);
    res.status(200).send(response);
    return;
  } catch (error) {
    if (error instanceof Error && (error.message === "USER_NOT_FOUND" || error.message === "PASSWORD_INCORRECT")) {
      res.status(401).send({ message: error.message });
      return;
    }
    next(error);
  }
}
