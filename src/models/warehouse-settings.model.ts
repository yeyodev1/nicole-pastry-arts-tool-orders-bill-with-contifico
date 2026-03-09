import { Schema, model, Document } from "mongoose";

export interface IWarehousePoint {
  name: string;
  isActive: boolean;
}

export interface IWarehouseSettings extends Document {
  key: "global";
  receptionPoints: IWarehousePoint[];
  dispatchPoints: IWarehousePoint[];
}

const WarehousePointSchema = new Schema<IWarehousePoint>(
  {
    name: { type: String, required: true },
    isActive: { type: Boolean, default: true },
  },
  { _id: true }
);

const WarehouseSettingsSchema = new Schema<IWarehouseSettings>(
  {
    key: { type: String, default: "global", unique: true },
    receptionPoints: { type: [WarehousePointSchema], default: [] },
    dispatchPoints: { type: [WarehousePointSchema], default: [] },
  },
  { timestamps: true, versionKey: false }
);

export const WarehouseSettingsModel = model<IWarehouseSettings>(
  "WarehouseSettings",
  WarehouseSettingsSchema
);
