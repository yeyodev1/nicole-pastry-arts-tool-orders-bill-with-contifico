import { Schema, model, Document } from "mongoose";

// Interface for User
export interface IUser extends Document {
  name: string;
  email: string;
  password?: string; // Optional because we might auto-generate or use other auth methods later
  role: "admin" | "sales" | "production";
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
    },
    role: {
      type: String,
      enum: ["admin", "sales", "production"],
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
