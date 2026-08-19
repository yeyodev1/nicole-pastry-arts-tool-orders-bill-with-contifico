import { Schema, model, Document, Types } from "mongoose";

// Interface for Commercial Agent
export interface ICommercialAgent {
  name: string;
  email?: string;
  phone?: string;
}

// Interface for Provider
export interface IProvider extends Document {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  ruc?: string;
  creditDays: number;
  contificoPersonaId?: string;
  fromContifico?: boolean; // true = proveedor importado/vinculado desde Contífico
  commercialAgents: ICommercialAgent[];
}

// Commercial Agent Schema (Embedded)
const CommercialAgentSchema = new Schema<ICommercialAgent>(
  {
    name: { type: String, required: true },
    email: { type: String },
    phone: { type: String },
  },
  { _id: false }
);

// Provider Schema
const ProviderSchema = new Schema<IProvider>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    address: {
      type: String,
      trim: true,
    },
    ruc: {
      type: String,
      trim: true,
    },
    // Días de crédito que otorga el proveedor (0 = contado)
    creditDays: {
      type: Number,
      default: 0,
      min: 0,
    },
    contificoPersonaId: {
      type: String,
      trim: true,
    },
    fromContifico: {
      type: Boolean,
      default: false,
      index: true,
    },
    commercialAgents: [CommercialAgentSchema],
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

// Export Model
export const ProviderModel = model<IProvider>("Provider", ProviderSchema);
