import { Schema, model, Document } from "mongoose";

export interface IProductionDestination {
  id: string;
  name: string;
  icon: string;
  matchKeywords: string[];
}

export interface IProductionSettings extends Document {
  key: "global";
  destinations: IProductionDestination[];
}

const ProductionDestinationSchema = new Schema<IProductionDestination>({
  id: { type: String, required: true },
  name: { type: String, required: true },
  icon: { type: String, required: true },
  matchKeywords: { type: [String], default: [] },
}, { _id: false });

const ProductionSettingsSchema = new Schema<IProductionSettings>(
  {
    key: {
      type: String,
      default: "global",
      unique: true,
    },
    destinations: {
      type: [ProductionDestinationSchema],
      default: [],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const ProductionSettingsModel = model<IProductionSettings>("ProductionSettings", ProductionSettingsSchema);
