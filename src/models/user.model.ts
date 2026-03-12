import { Schema, model, Document } from "mongoose";

// Interface for User
export interface IUser extends Document {
  name: string;
  email: string;
  password?: string; // Optional because we might auto-generate or use other auth methods later
  role: "admin" | "sales" | "production" | "RetailManager" | "SUPPLY_CHAIN_MANAGER" | "SALES_MANAGER" | "SALES_REP" | "KITCHEN_DISPLAY";
}

// User Schema
const UserSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
      unique: true,
    },
    password: {
      type: String,
      required: true,
      select: false,
    },
    role: {
      type: String,
      enum: ["admin", "sales", "production", "RetailManager", "SUPPLY_CHAIN_MANAGER", "SALES_MANAGER", "SALES_REP", "KITCHEN_DISPLAY"],
      default: "sales",
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Export Model
export const UserModel = model<IUser>("User", UserSchema);
