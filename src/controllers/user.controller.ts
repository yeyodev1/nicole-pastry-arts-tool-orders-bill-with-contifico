import type { Request, Response, NextFunction } from "express";
import { UserService } from "../services/user.service";
import { AuthRequest } from "../types/AuthRequest";

const userService = new UserService();

export async function forgotPassword(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      res.status(400).send({ message: "EMAIL_REQUIRED" });
      return;
    }

    await userService.requestPasswordReset(email);

    // Siempre 200: no revelar si el email existe o no
    res.status(200).send({
      message: "Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.",
    });
    return;
  } catch (error) {
    console.error("Error in forgotPassword:", error);
    // Igual respondemos 200 para no filtrar información; el error queda en logs
    res.status(200).send({
      message: "Si el correo está registrado, recibirás un enlace para restablecer tu contraseña.",
    });
    return;
  }
}

export async function resetPassword(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    const { token, password } = req.body;
    await userService.resetPassword(token, password);
    res.status(200).send({ message: "Contraseña actualizada correctamente." });
    return;
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_RESET_REQUEST") {
      res.status(400).send({ message: "La contraseña debe tener al menos 8 caracteres." });
      return;
    }
    if (error instanceof Error && error.message === "INVALID_OR_EXPIRED_TOKEN") {
      res.status(400).send({ message: "El enlace no es válido o ya expiró. Solicita uno nuevo." });
      return;
    }
    next(error);
  }
}

export async function createUser(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const user = await userService.createUser(req.body);
    res.status(201).send({
      message: "User created successfully.",
      data: user
    });
    return;
  } catch (error: any) {
    if (error.code === 11000) {
      res.status(409).send({ message: "EMAIL_ALREADY_REGISTERED" });
      return;
    }
    next(error);
  }
}

export async function getAllUsers(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const jwtUser = req.user;

    // Fetch fresh user from DB to avoid completely stale JWT role payloads
    const currentUser = jwtUser?.email ? await userService.findByEmail(jwtUser.email) : null;
    const currentRole = currentUser?.role?.toUpperCase();

    let users: any[];

    if (currentRole === "ADMIN") {
      users = await userService.findAll();
    } else if (currentRole === "SALES_MANAGER") {
      users = await userService.findAll(["SALES_REP", "SALES_MANAGER"]);
    } else {
      users = currentUser ? [currentUser] : [];
    }

    res.status(200).send({
      message: "Users retrieved successfully.",
      data: users
    });
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

export async function updateUser(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { id } = req.params;
    const user = await userService.updateUser(id, req.body);
    res.status(200).send({
      message: "User updated successfully.",
      data: user
    });
    return;
  } catch (error) {
    next(error);
  }
}

export async function deleteUser(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const { id } = req.params;

    // Prevent self-deletion
    if (req.user?.id === id) {
      res.status(403).send({ message: "You cannot delete your own account." });
      return;
    }

    await userService.deleteUser(id);
    res.status(200).send({
      message: "User deleted successfully."
    });
    return;
  } catch (error) {
    next(error);
  }
}
