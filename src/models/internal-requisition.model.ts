import { Schema, model, Document, Types } from "mongoose";

// Requerimiento interno: cocina/producción/isla pide ítems de bodega.
// Flujo: REQUESTED → PREPARING → DISPATCHED → CONFIRMED (o CANCELLED)
export interface IRequisitionItem {
  material: Types.ObjectId;
  name: string;
  quantity: number; // Solicitado
  unit: string;
  quantityDispatched?: number; // Lo realmente entregado
  itemNote?: string; // "faltó esto", etc.
}

export interface IInternalRequisition extends Document {
  requestedBy: Types.ObjectId;
  requestedByName: string;
  area: string; // Cocina, Producción Finestra, Producción Sucree, Isla X…
  brand?: string; // Marca a la que se carga el gasto (Nicole, Sucree, Casa Mía, La Crème)
  neededForDate?: Date;
  items: IRequisitionItem[];
  status: "REQUESTED" | "PREPARING" | "DISPATCHED" | "CONFIRMED" | "CANCELLED";
  notes?: string;
  dispatchedBy?: string;
  dispatchedAt?: Date;
  // "Firma" electrónica de quien recibe en el área solicitante
  confirmedBy?: string;
  confirmedAt?: Date;
  confirmationNote?: string;
  movementBatchId?: string; // batchId de los movimientos OUT generados al despachar
  createdAt: Date;
  updatedAt: Date;
}

const RequisitionItemSchema = new Schema<IRequisitionItem>(
  {
    material: { type: Schema.Types.ObjectId, ref: "RawMaterial", required: true },
    name: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unit: { type: String, required: true },
    quantityDispatched: { type: Number, min: 0 },
    itemNote: { type: String, trim: true },
  },
  { _id: true }
);

const InternalRequisitionSchema = new Schema<IInternalRequisition>(
  {
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    requestedByName: { type: String, required: true, trim: true },
    area: { type: String, required: true, trim: true },
    brand: { type: String, trim: true },
    neededForDate: { type: Date },
    items: { type: [RequisitionItemSchema], required: true },
    status: {
      type: String,
      enum: ["REQUESTED", "PREPARING", "DISPATCHED", "CONFIRMED", "CANCELLED"],
      default: "REQUESTED",
      index: true,
    },
    notes: { type: String, trim: true },
    dispatchedBy: { type: String, trim: true },
    dispatchedAt: { type: Date },
    confirmedBy: { type: String, trim: true },
    confirmedAt: { type: Date },
    confirmationNote: { type: String, trim: true },
    movementBatchId: { type: String, trim: true, index: true },
  },
  { timestamps: true, versionKey: false }
);

export const InternalRequisitionModel = model<IInternalRequisition>(
  "InternalRequisition",
  InternalRequisitionSchema
);
