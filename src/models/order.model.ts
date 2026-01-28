import { Schema, model, Document, Types } from "mongoose";

export interface IOrderProduct {
  _id?: Types.ObjectId;
  name: string;
  quantity: number;
  price: number;
  contifico_id?: string;
  produced?: number; // Track how many items have been produced
  productionStatus?: "PENDING" | "IN_PROCESS" | "COMPLETED";
  productionNotes?: string;
}

export interface IDispatchItem {
  productId: string; // The _id of the product in the products array
  name: string;      // Snapshot of name for UI ease
  quantitySent: number;
}

export interface IDispatch {
  _id: Types.ObjectId;
  reportedAt: Date;
  modifiedAt: Date;
  destination: string; // e.g. "San Marino", "Delivery @ Address"
  items: IDispatchItem[];
  notes?: string;
  reportedBy: string; // e.g. "Production User"
}

export interface IOrder extends Document {
  // ... existing fields ...
  orderDate: Date;
  deliveryDate: Date;
  deliveryTime?: string;
  customerName: string;
  customerPhone: string;
  salesChannel: string;
  products: IOrderProduct[];
  deliveryType: "delivery" | "retiro";
  branch?: "San Marino" | "Mall del Sol" | "Centro de Producción";
  googleMapsLink?: string;
  deliveryAddress?: string;
  totalValue: number;
  deliveryValue: number;
  paymentMethod: string;
  invoiceNeeded: boolean;
  responsible: "Hillary" | "E" | "Ivin" | "Web";
  comments?: string;
  invoiceData?: {
    ruc: string;
    businessName: string;
    email: string;
    address: string;
  };
  invoiceStatus?: "PENDING" | "PROCESSED" | "ERROR";
  invoiceInfo?: any;
  productionStage: "PENDING" | "IN_PROCESS" | "FINISHED" | "DELAYED";
  productionNotes: string;

  // Dispatch Fields
  dispatches: IDispatch[];
  dispatchStatus: "NOT_SENT" | "PARTIAL" | "SENT" | "PROBLEM";

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

const DispatchSchema = new Schema<IDispatch>({
  reportedAt: { type: Date, default: Date.now },
  modifiedAt: { type: Date, default: Date.now },
  destination: { type: String, required: true },
  items: [
    {
      productId: { type: String, required: true },
      name: { type: String },
      quantitySent: { type: Number, required: true }
    }
  ],
  notes: { type: String },
  reportedBy: { type: String, default: "Producción" }
});

const OrderSchema = new Schema<IOrder>(
  {
    orderDate: { type: Date, required: true },
    deliveryDate: { type: Date, required: true },
    deliveryTime: { type: String, required: false },
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
      required: false
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

    // Dispatch Fields
    dispatches: { type: [DispatchSchema], default: [] },
    dispatchStatus: {
      type: String,
      enum: ["NOT_SENT", "PARTIAL", "SENT", "PROBLEM"],
      default: "NOT_SENT"
    },

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
