import { Schema, model, Document, Types } from "mongoose";

export interface IOrderProduct {
  name: string;
  quantity: number;
  price: number;
  contifico_id?: string;
  produced?: number; // Track how many items have been produced
  productionStatus?: "PENDING" | "IN_PROCESS" | "COMPLETED";
  productionNotes?: string;
}

export interface IOrder extends Document {
  orderDate: Date;
  deliveryDate: Date;
  deliveryTime?: string; // Specific time string (e.g. "14:30")
  customerName: string;
  customerPhone: string;
  salesChannel: string;
  products: IOrderProduct[];
  deliveryType: "delivery" | "retiro";
  branch?: "San Marino" | "Mall del Sol" | "Centro de Producción"; // New branch field
  googleMapsLink?: string; // For delivery
  deliveryAddress?: string; // Written address
  totalValue: number;
  deliveryValue: number;
  paymentMethod: string;
  invoiceNeeded: boolean;
  responsible: "Hillary" | "E" | "Ivin" | "Web";
  comments?: string;
  // Invoice data (optional if invoiceNeeded is false)
  invoiceData?: {
    ruc: string;
    businessName: string;
    email: string;
    address: string;
  };
  invoiceStatus?: "PENDING" | "PROCESSED" | "ERROR";
  invoiceInfo?: any; // To store the result from Contífico
  // Production Fields
  productionStage: "PENDING" | "IN_PROCESS" | "FINISHED" | "DELAYED";
  productionNotes: string;
  paymentDetails?: {
    forma_cobro: string;
    monto: number;
    fecha: string;
    numero_comprobante?: string;
    cuenta_bancaria_id?: string;
    tipo_ping?: string;
    numero_tarjeta?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}

const OrderSchema = new Schema<IOrder>(
  {
    orderDate: { type: Date, required: true },
    deliveryDate: { type: Date, required: true },
    deliveryTime: { type: String, required: false }, // New optional field (was required causing issues)
    customerName: { type: String, required: true },
    customerPhone: { type: String, required: true },
    salesChannel: { type: String, required: true },
    products: [
      {
        name: { type: String, required: true },
        quantity: { type: Number, required: true },
        price: { type: Number, required: true },
        contifico_id: { type: String },
        produced: { type: Number, default: 0 },
        // Granular production tracking
        productionStatus: {
          type: String,
          enum: ["PENDING", "IN_PROCESS", "COMPLETED"],
          default: "PENDING"
        },
        productionNotes: { type: String }
      },
    ],
    deliveryType: {
      type: String,
      enum: ["delivery", "retiro"],
      required: true,
    },
    branch: {
      type: String,
      enum: ["San Marino", "Mall del Sol", "Centro de Producción"],
      required: false // Optional because delivery might not always imply a "source branch" in all legacy data, but we will enforce in UI
    },
    googleMapsLink: { type: String },
    deliveryAddress: { type: String },
    totalValue: { type: Number, required: true },
    deliveryValue: { type: Number, default: 0 },
    paymentMethod: { type: String, required: true },
    invoiceNeeded: { type: Boolean, default: false },
    invoiceStatus: {
      type: String,
      enum: ["PENDING", "PROCESSED", "ERROR"],
      default: function () {
        return this.invoiceNeeded ? "PENDING" : undefined;
      }
    },
    responsible: {
      type: String,
      enum: ["Hillary", "E", "Ivin", "Web"],
      required: true,
    },
    comments: { type: String },
    invoiceData: {
      ruc: { type: String },
      businessName: { type: String },
      email: { type: String },
      address: { type: String },
    },
    // Production Fields
    productionStage: {
      type: String,
      enum: ["PENDING", "IN_PROCESS", "FINISHED", "DELAYED"],
      default: "PENDING"
    },
    productionNotes: { type: String, default: "" },
    // Payment Data (Stored for batch processing)
    paymentDetails: {
      forma_cobro: String,
      monto: Number,
      fecha: String,
      numero_comprobante: String,
      cuenta_bancaria_id: String,
      tipo_ping: String,
      numero_tarjeta: String
    }
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const OrderModel = model<IOrder>("Order", OrderSchema);
