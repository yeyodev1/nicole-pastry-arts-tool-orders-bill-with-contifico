import { Schema, model, Document, Types } from "mongoose";

// Préstamo/traspaso interno entre bodegas (ej. Nicole ↔ Sucree).
// Se devuelve en la misma unidad; si no se devuelve queda como deuda.
export interface ILoanItem {
  material: Types.ObjectId;
  name: string;
  quantity: number;
  unit: string;
  quantityReturned: number;
}

export interface IWarehouseLoan extends Document {
  fromPoint: string; // Bodega que presta
  toPoint: string; // Bodega que recibe
  items: ILoanItem[];
  status: "LENT" | "PARTIALLY_RETURNED" | "RETURNED" | "WRITTEN_OFF";
  user: Types.ObjectId;
  responsible?: string;
  notes?: string;
  returnedAt?: Date;
  writtenOffAt?: Date;
  writeOffNote?: string;
  movementBatchId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const LoanItemSchema = new Schema<ILoanItem>(
  {
    material: { type: Schema.Types.ObjectId, ref: "RawMaterial", required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    quantityReturned: { type: Number, default: 0, min: 0 },
  },
  { _id: true }
);

const WarehouseLoanSchema = new Schema<IWarehouseLoan>(
  {
    fromPoint: { type: String, required: true, trim: true },
    toPoint: { type: String, required: true, trim: true },
    items: { type: [LoanItemSchema], required: true },
    status: {
      type: String,
      enum: ["LENT", "PARTIALLY_RETURNED", "RETURNED", "WRITTEN_OFF"],
      default: "LENT",
      index: true,
    },
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    responsible: { type: String, trim: true },
    notes: { type: String, trim: true },
    returnedAt: { type: Date },
    writtenOffAt: { type: Date },
    writeOffNote: { type: String, trim: true },
    movementBatchId: { type: String, trim: true, index: true },
  },
  { timestamps: true, versionKey: false }
);

export const WarehouseLoanModel = model<IWarehouseLoan>(
  "WarehouseLoan",
  WarehouseLoanSchema
);
