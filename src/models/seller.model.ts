import mongoose, { Schema, Document } from "mongoose";

/**
 * Vendedor asignable a una factura.
 *
 * Contífico acepta un vendedor por documento (`vendedor_id` / objeto `vendedor`),
 * y de ahí sale el reporte de comisiones. Estas personas ya existen en Contífico
 * marcadas con `es_vendedor: true`; aquí guardamos el puente nombre → cédula → id.
 */
export interface ISeller extends Document {
  /** Nombre como debe salir en la factura (razón social en Contífico). */
  name: string;
  /** Cédula. Es la llave con la que Contífico identifica a la persona. */
  identification: string;
  /** ID de la persona en Contífico (16 caracteres). */
  contificoPersonId?: string;
  /** Cuenta de Contífico a la que pertenece. */
  contificoSource: "nicole" | "sucree";
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}

const sellerSchema = new Schema<ISeller>(
  {
    name: { type: String, required: true, trim: true },
    identification: { type: String, required: true, trim: true },
    contificoPersonId: { type: String, trim: true },
    contificoSource: { type: String, enum: ["nicole", "sucree"], default: "nicole" },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true }
);

sellerSchema.index({ contificoSource: 1, identification: 1 }, { unique: true });

export const SellerModel = mongoose.model<ISeller>("Seller", sellerSchema);
