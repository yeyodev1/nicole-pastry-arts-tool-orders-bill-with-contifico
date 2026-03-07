import { Schema, model, Document } from "mongoose";

// Singleton document — only one instance with key: "global"
export interface IGoalSettings extends Document {
  key: "global";
  managerGoal: number;
  sellerGoal: number;
  // Per-person overrides keyed by stat._id (person name from analytics)
  individualGoals: Map<string, number>;
  // Dynamic commission tiers. Rate is percentage (e.g., 2 for 2%)
  commissionTiers: Array<{ threshold: number; rate: number }>;
}

const GoalSettingsSchema = new Schema<IGoalSettings>(
  {
    key: {
      type: String,
      default: "global",
      unique: true,
    },
    managerGoal: {
      type: Number,
      required: true,
      default: 7000,
    },
    sellerGoal: {
      type: Number,
      required: true,
      default: 10000,
    },
    individualGoals: {
      type: Map,
      of: Number,
      default: {},
    },
    commissionTiers: {
      type: [
        {
          threshold: { type: Number, required: true },
          rate: { type: Number, required: true },
        },
      ],
      default: [
        { threshold: 0, rate: 2 },
        { threshold: 10000, rate: 3 },
        { threshold: 13000, rate: 6 }
      ],
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

export const GoalSettingsModel = model<IGoalSettings>("GoalSettings", GoalSettingsSchema);

