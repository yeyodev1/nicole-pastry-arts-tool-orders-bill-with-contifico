import { Schema, model, Document } from "mongoose";

export interface IDailySummary extends Document {
  date: string; // Format YYYY-MM-DD or DD/MM/YYYY. Let's use Date object normalized to midnight UTC or string YYYY-MM-DD for easy sorting.
  // Actually, keeping string DD/MM/YYYY matches Contifico input, but YYYY-MM-DD is better for sorting mongo.
  // Let's use ISO Date set to noon or string YYYY-MM-DD.
  dateIso: Date;
  totalSales: number;
  transactionCount: number;
  lastUpdated: Date;
}

const DailySummarySchema = new Schema<IDailySummary>(
  {
    dateIso: { type: Date, required: true, unique: true }, // Index for fast range queries
    totalSales: { type: Number, default: 0 },
    transactionCount: { type: Number, default: 0 },
    lastUpdated: { type: Date, default: Date.now }
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const DailySummaryModel = model<IDailySummary>("DailySummary", DailySummarySchema);
