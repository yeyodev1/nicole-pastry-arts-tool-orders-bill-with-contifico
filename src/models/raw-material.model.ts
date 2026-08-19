import { Schema, model, Document, Types } from "mongoose";

export interface IRawMaterialProvider {
  provider: Types.ObjectId;
  price: number;
  isMain: boolean;
}

// Interface for Raw Material
export interface IRawMaterial extends Document {
  name: string;
  item?: string; // Base item name for grouping
  code?: string; // Generated SKU/Code
  unit: "g" | "ml" | "u";
  quantity: number;
  cost: number; // Unit cost (auto-calculated from main provider)
  wastePercentage: number; // 0-100%
  minStock: number;
  maxStock: number;
  provider?: Types.ObjectId; // Kept for BC, synced with isMain provider
  providers: IRawMaterialProvider[];
  category?: string;

  // Professional Presentation Fields
  presentationName?: string;
  presentationPrice?: number;
  presentationQuantity?: number;

  // Tracking Fields
  lastInvoice?: string;
  lastEntryNumber?: string;
  lastMovementDate?: Date;

  // Vínculo con Contífico
  contificoId?: string;
  contificoSource?: "nicole" | "sucree";
}

// Raw Material Schema
const RawMaterialSchema = new Schema<IRawMaterial>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    item: {
      type: String,
      required: false,
      trim: true,
    },
    code: {
      type: String,
      required: false,
      trim: true,
    },
    unit: {
      type: String,
      enum: ["g", "ml", "u"],
      required: true,
    },
    quantity: {
      type: Number,
      required: true,
      default: 0,
    },
    cost: {
      type: Number,
      required: true,
      default: 0,
    },
    wastePercentage: {
      type: Number,
      required: false,
      default: 0,
    },
    minStock: {
      type: Number,
      required: false,
      default: 0,
    },
    maxStock: {
      type: Number,
      required: false,
      default: 0,
    },
    provider: {
      type: Schema.Types.ObjectId,
      ref: "Provider",
    },
    providers: [
      {
        provider: { type: Schema.Types.ObjectId, ref: "Provider", required: true },
        price: { type: Number, required: true, default: 0 },
        isMain: { type: Boolean, required: true, default: false },
      }
    ],
    category: {
      type: String,
      required: false,
      default: "Sin Categoría",
      trim: true
    },
    // Professional Presentation Fields
    presentationName: {
      type: String,
      required: false,
      trim: true,
    },
    presentationPrice: {
      type: Number,
      required: false,
      default: 0,
    },
    presentationQuantity: {
      type: Number,
      required: false,
      default: 1, // Avoid division by zero
    },
    // Tracking Fields
    lastInvoice: {
      type: String,
      required: false,
      trim: true,
    },
    lastEntryNumber: {
      type: String,
      required: false,
      trim: true,
    },
    lastMovementDate: {
      type: Date,
      required: false,
    },
    contificoId: {
      type: String,
      trim: true,
      index: true,
    },
    contificoSource: {
      type: String,
      enum: ["nicole", "sucree"],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Export Model
export const RawMaterialModel = model<IRawMaterial>("RawMaterial", RawMaterialSchema);
