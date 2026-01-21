
import { OrderModel } from "../models/order.model";

export class ProductionService {
  /**
   * Returns production tasks (Orders), sorted by delivery date (urgency).
   */
  async getProductionTasks() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const tasks = await OrderModel.find({
      $or: [
        { productionStage: { $ne: "FINISHED" } },
        {
          productionStage: "FINISHED",
          updatedAt: { $gte: yesterday }
        }
      ]
    }).sort({ deliveryDate: 1 });

    return tasks;
  }

  async updateTask(id: string, updates: { stage?: string; notes?: string }) {
    const updateData: any = {};
    if (updates.stage) updateData.productionStage = updates.stage;
    if (updates.notes !== undefined) updateData.productionNotes = updates.notes;

    return await OrderModel.findByIdAndUpdate(id, updateData, { new: true });
  }

  /**
   * Batch update multiple tasks (e.g. mark all as FINISHED)
   */
  async batchUpdateTasks(ids: string[], updates: { stage?: string }) {
    const updateData: any = {};
    if (updates.stage) updateData.productionStage = updates.stage;

    // Update multiple documents
    return await OrderModel.updateMany(
      { _id: { $in: ids } },
      { $set: updateData }
    );
  }

  async getAggregatedItems() {
    // Show ALL pending items (Today, Tomorrow, Future)
    // No date filter needed anymore as per user request
    const items = await OrderModel.aggregate([
      {
        $match: {
          productionStage: { $in: ["PENDING", "IN_PROCESS"] },
        },
      },
      { $unwind: "$products" },
      {
        $group: {
          _id: "$products.name",
          totalQuantity: { $sum: "$products.quantity" },
          urgency: { $min: "$deliveryDate" },
          orders: {
            $push: {
              id: "$_id",
              quantity: "$products.quantity",
              client: "$customerName",
              delivery: "$deliveryDate",
              stage: "$productionStage"
            },
          },
        },
      },
      { $sort: { urgency: 1 } },
    ]);
    return items;
  }

  // ... Legacy summary method if needed
  async getProductionSummary(days: number = 7) {
    // (Can remain or be removed/ignored)
    return []
  }
}
