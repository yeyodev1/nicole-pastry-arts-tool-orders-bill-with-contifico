
import { OrderModel } from "../models/order.model";

export class ProductionService {
  /**
   * Returns production tasks (Orders), sorted by delivery date (urgency).
   * Fetches orders that are NOT Finished OR are recently finished (to see history/corrections).
   */
  async getProductionTasks() {
    // Define a "recent" threshold for finished orders if we want to show them?
    // For now, let's just show everything that is NOT FINISHED + everything that IS FINISHED but delivered TODAY or FUTURE (just in case they finished early but delivery is today)
    // Actually, simple logic: Show all active (Pending, In Process) orders.
    // And maybe show Finished orders from the last 24h?

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const tasks = await OrderModel.find({
      $or: [
        { productionStage: { $ne: "FINISHED" } }, // PENDING or IN_PROCESS
        {
          productionStage: "FINISHED",
          updatedAt: { $gte: yesterday } // Completed recently
        }
      ]
    }).sort({ deliveryDate: 1 }); // Urgent first

    return tasks;
  }

  async updateTask(id: string, updates: { stage?: string; notes?: string }) {
    const updateData: any = {};
    if (updates.stage) updateData.productionStage = updates.stage;
    if (updates.notes !== undefined) updateData.productionNotes = updates.notes;

    return await OrderModel.findByIdAndUpdate(id, updateData, { new: true });
  }
}
