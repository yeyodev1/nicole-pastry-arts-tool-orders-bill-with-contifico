import bcrypt from "bcryptjs";
import crypto from "crypto";
import { models } from "../models";
import { IUser } from "../models/user.model";
import { generateToken } from "../utils/jwt.handle";
import { EmailService } from "./email.service";

const FRONTEND_URL = process.env.FRONTEND_URL || "https://app.nicole.com.ec";

export class UserService {
  /**
   * Login user
   */
  async loginUser({ email, password }: Pick<IUser, "email" | "password">) {
    const user = await models.users.findOne({ email }).select("+password");
    if (!user) throw new Error("USER_NOT_FOUND");

    const passwordHash = user.password;
    const isCorrect = await bcrypt.compare(password!, passwordHash!);

    if (!isCorrect) throw new Error("PASSWORD_INCORRECT");

    const token = await generateToken(user);

    const userObj = user.toObject();
    delete userObj.password;

    const data = {
      token,
      user: userObj,
    };

    return data;
  }

  /**
   * Create a new user with hashed password
   */
  async createUser(data: Partial<IUser>) {
    const { password, ...rest } = data;
    const hashedPassword = await bcrypt.hash(password || "123456", 10);

    const newUser = await models.users.create({
      ...rest,
      password: hashedPassword,
    });

    const userObj = newUser.toObject();
    delete userObj.password;

    return userObj;
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string) {
    return await models.users.findOne({ email }).select('-password').lean();
  }

  /**
   * Get all users
   */
  async findAll(roleFilter?: string[]) {
    const query = roleFilter && roleFilter.length > 0
      ? { role: { $in: roleFilter } }
      : {};
    return await models.users.find(query).select('-password').lean();
  }

  /**
   * Update user
   */
  async updateUser(id: string, data: Partial<IUser>) {
    const { password, ...rest } = data;
    const updateData: any = { ...rest };

    if (password && password.trim() !== "") {
      updateData.password = await bcrypt.hash(password, 10);
    }

    const updatedUser = await models.users.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    );

    if (!updatedUser) throw new Error("USER_NOT_FOUND");

    const userObj = updatedUser.toObject();
    delete userObj.password;
    return userObj;
  }

  /**
   * Delete user
   */
  async deleteUser(id: string) {
    const result = await models.users.findByIdAndDelete(id);
    if (!result) throw new Error("USER_NOT_FOUND");
    return true;
  }

  /**
   * Solicita reset de contraseña: genera token (1h), lo guarda hasheado
   * y envía el email con el link. No revela si el email existe.
   */
  async requestPasswordReset(email: string) {
    const user = await models.users.findOne({ email: email.toLowerCase().trim() });
    if (!user) return; // Silencioso: no revelar existencia de cuentas

    const rawToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = crypto.createHash("sha256").update(rawToken).digest("hex");

    user.resetPasswordToken = hashedToken;
    user.resetPasswordExpires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora
    await user.save();

    const resetUrl = `${FRONTEND_URL}/reset-password?token=${rawToken}`;
    const emailService = new EmailService();
    await emailService.sendPasswordResetEmail(user.email, user.name, resetUrl);
  }

  /**
   * Restablece la contraseña con un token válido y no expirado.
   */
  async resetPassword(token: string, newPassword: string) {
    if (!token || !newPassword || newPassword.length < 8) {
      throw new Error("INVALID_RESET_REQUEST");
    }

    const hashedToken = crypto.createHash("sha256").update(token).digest("hex");

    const user = await models.users
      .findOne({
        resetPasswordToken: hashedToken,
        resetPasswordExpires: { $gt: new Date() },
      })
      .select("+resetPasswordToken +resetPasswordExpires");

    if (!user) throw new Error("INVALID_OR_EXPIRED_TOKEN");

    user.password = await bcrypt.hash(newPassword, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    return true;
  }

  /**
   * Seed initial users if they don't exist
   */
  async seedInitialUsers() {
    const usersToSeed = [
      {
        email: "ventas@nicole.com.ec",
        password: "Nicole2020!",
        name: "Ventas",
        role: "SALES_MANAGER",
      },
      {
        email: "produccion@nicole.com.ec",
        password: "Nicole2020!",
        name: "Producción",
        role: "production",
      },
      {
        email: "retailmanager@nicole.com.ec",
        password: "Nicole2020!",
        name: "Retail Manager",
        role: "RetailManager",
      },
      {
        email: "compras@nicole.com.ec",
        password: "Nicole2020!",
        name: "Supply Chain Manager",
        role: "SUPPLY_CHAIN_MANAGER",
      },
      {
        email: "cocina@nicole.com.ec",
        password: "Nicole2020!",
        name: "Pantalla Cocina",
        role: "KITCHEN_DISPLAY",
      },
    ];


    for (const userData of usersToSeed) {
      const exists = await this.findByEmail(userData.email);
      if (!exists) {
        await this.createUser(userData as IUser);
        console.log(`✅ Seeded user: ${userData.email}`);
      }
    }

    // Example instructions for Sales Manager:
    // User ventas@nicole.com.ec can now create SALES_REP users via the Management API.

  }
}
