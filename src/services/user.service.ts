import bcrypt from "bcryptjs";
import { models } from "../models";
import { IUser } from "../models/user.model";
import { generateToken } from "../utils/jwt.handle";

export class UserService {
  /**
   * Login user
   */
  async loginUser({ email, password }: Pick<IUser, "email" | "password">) {
    const user = await models.users.findOne({ email });
    if (!user) throw new Error("USER_NOT_FOUND");

    const passwordHash = user.password;
    const isCorrect = await bcrypt.compare(password!, passwordHash!);

    if (!isCorrect) throw new Error("PASSWORD_INCORRECT");

    const token = await generateToken(user.id);

    const data = {
      token,
      user,
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

    return newUser;
  }

  /**
   * Find user by email
   */
  async findByEmail(email: string) {
    return await models.users.findOne({ email });
  }

  /**
   * Get all users
   */
  async findAll() {
    return await models.users.find().select("-password");
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
        role: "sales",
      },
      {
        email: "produccion@nicole.com.ec",
        password: "Nicole2020!",
        name: "Producción",
        role: "production",
      },
    ];

    console.log("🌱 Checking users seed...");

    for (const userData of usersToSeed) {
      const exists = await this.findByEmail(userData.email);
      if (!exists) {
        console.log(`Creating user: ${userData.email} [${userData.role}]`);
        await this.createUser(userData as IUser);
      } else {
        console.log(`User already exists: ${userData.email}`);
      }
    }

    console.log("✅ Users seed check completed.");
  }
}
