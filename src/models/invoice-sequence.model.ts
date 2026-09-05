import mongoose, { Schema, Document } from "mongoose";

/**
 * Contador atómico del secuencial de facturas por serie (establecimiento-punto de emisión).
 *
 * Reemplaza al número aleatorio que se generaba antes (`Math.random()`), que podía
 * chocar con un secuencial ya emitido o saltar cientos de miles de números en la
 * serie del SRI.
 */
export interface IInvoiceSequence extends Document {
  /** Serie del documento, ej. "001-001". */
  serie: string;
  /** Último secuencial entregado para esa serie. */
  lastSequential: number;
  /** Cuenta de Contífico dueña de la serie ("nicole" | "sucree"). */
  source: string;
  createdAt: Date;
  updatedAt: Date;
}

const invoiceSequenceSchema = new Schema<IInvoiceSequence>(
  {
    serie: { type: String, required: true, trim: true },
    lastSequential: { type: Number, required: true, default: 0 },
    source: { type: String, required: true, default: "nicole" },
  },
  { timestamps: true }
);

invoiceSequenceSchema.index({ source: 1, serie: 1 }, { unique: true });

export const InvoiceSequenceModel = mongoose.model<IInvoiceSequence>(
  "InvoiceSequence",
  invoiceSequenceSchema
);
