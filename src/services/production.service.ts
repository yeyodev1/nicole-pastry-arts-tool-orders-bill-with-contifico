
import { OrderModel } from "../models/order.model";

export class ProductionService {
  /**
   * Returns production tasks (Orders), sorted by delivery date (urgency).
   */
  async getProductionTasks() {
    // 1. First, find candidate orders (active)
    const tasks = await OrderModel.find({
      productionStage: { $in: ["PENDING", "IN_PROCESS", "DELAYED"] }
    }).sort({ deliveryDate: 1 });

    // 2. Check for "Overtime" (DELAYED) status update
    const now = new Date();
    const updatedTasks = [];

    for (const task of tasks) {
      // If delivery date has passed and it's not finished, mark as DELAYED
      if (task.deliveryDate < now && task.productionStage !== "DELAYED") {
        task.productionStage = "DELAYED";
        await task.save();
      }
      updatedTasks.push(task);
    }

    return updatedTasks;
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
    // 1. Fetch flattened list of all pending items
    const rawItems = await OrderModel.aggregate([
      {
        $match: {
          productionStage: { $in: ["PENDING", "IN_PROCESS", "DELAYED"] },
        },
      },
      { $unwind: "$products" },
      {
        $match: {
          "products.productionStatus": { $ne: "COMPLETED" },
        },
      },
      {
        $addFields: {
          "products.produced": { $ifNull: ["$products.produced", 0] },
        },
      },
      {
        $addFields: {
          pendingQuantity: { $subtract: ["$products.quantity", "$products.produced"] },
        },
      },
      {
        $match: {
          pendingQuantity: { $gt: 0 },
        },
      },
      {
        $project: {
          // Flatten structure for easier JS processing
          productName: "$products.name",
          totalInOrder: "$products.quantity",
          producedInOrder: "$products.produced",
          pendingInOrder: "$pendingQuantity",
          productionNotes: "$products.productionNotes",
          productionStatus: "$products.productionStatus",
          deliveryDate: "$deliveryDate",
          customerName: "$customerName",
          stage: "$productionStage",
          orderId: "$_id"
        }
      },
      { $sort: { deliveryDate: 1 } }
    ]);

    // 2. Define Time Buckets
    const todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    const tomorrowEnd = new Date(todayEnd);
    tomorrowEnd.setDate(tomorrowEnd.getDate() + 1);

    // 3. Helper to group by Product Name within a bucket
    const groupItems = (items: any[]) => {
      const groupedMap = new Map<string, any>();

      for (const item of items) {
        if (!groupedMap.has(item.productName)) {
          groupedMap.set(item.productName, {
            _id: item.productName,
            totalQuantity: 0,
            urgency: item.deliveryDate, // First one is earliest due to sort
            orders: []
          });
        }

        const group = groupedMap.get(item.productName);
        group.totalQuantity += item.pendingInOrder;
        group.orders.push({
          id: item.orderId,
          totalInOrder: item.totalInOrder,
          producedInOrder: item.producedInOrder,
          pendingInOrder: item.pendingInOrder,
          client: item.customerName,
          delivery: item.deliveryDate,
          stage: item.stage,
          notes: item.productionNotes,
          status: item.productionStatus
        });
      }
      return Array.from(groupedMap.values());
    };

    // 4. Distribute items into buckets
    const buckets = {
      todayItems: [] as any[],
      tomorrowItems: [] as any[],
      futureItems: [] as any[]
    };

    for (const item of rawItems) {
      const uDate = new Date(item.deliveryDate);

      if (uDate <= todayEnd) {
        buckets.todayItems.push(item);
      } else if (uDate <= tomorrowEnd) {
        buckets.tomorrowItems.push(item);
      } else {
        buckets.futureItems.push(item);
      }
    }

    // 5. Group and Return
    return {
      today: groupItems(buckets.todayItems),
      tomorrow: groupItems(buckets.tomorrowItems),
      future: groupItems(buckets.futureItems)
    };
  }

  async updateProductStatus(orderId: string, productName: string, status: "PENDING" | "IN_PROCESS" | "COMPLETED", notes?: string) {
    const order = await OrderModel.findById(orderId);
    if (!order) return null;

    const product = order.products.find(p => p.name === productName);
    if (!product) return null;

    if (status) product.productionStatus = status;
    if (notes !== undefined) product.productionNotes = notes;

    // Check if we should auto-update delivered/produced counts? 
    // If completed, maybe set produced = quantity?
    if (status === "COMPLETED") {
      product.produced = product.quantity;
    }

    // Recalculate Order Stage
    const allProductsDone = order.products.every(p => p.productionStatus === "COMPLETED" || (p.produced || 0) >= p.quantity);
    if (allProductsDone) {
      order.productionStage = "FINISHED";
    } else {
      // If at least one is in process or completed
      const anyAction = order.products.some(p => p.productionStatus !== "PENDING" || (p.produced || 0) > 0);
      if (anyAction && order.productionStage === "PENDING") {
        order.productionStage = "IN_PROCESS";
      }
    }

    await order.save();
    return order;
  }

  /**
   * Register progress for a specific product type (e.g. "Made 10 Lemon Tarts").
   * Automatically distributes the produced amount to the oldest pending orders (FIFO).
   */
  async registerProductionProgress(productName: string, quantityMade: number) {
    let remainingToDistribute = quantityMade;

    // Find all active orders containing this product, sorted by urgency (deliveryDate ASC)
    const orders = await OrderModel.find({
      productionStage: { $in: ["PENDING", "IN_PROCESS", "DELAYED"] },
      "products.name": productName,
    }).sort({ deliveryDate: 1 });

    for (const order of orders) {
      if (remainingToDistribute <= 0) break;

      let orderUpdated = false;

      // Iterate through products in the order to find the match
      for (const product of order.products) {
        if (product.name === productName) {
          const currentProduced = product.produced || 0;
          const needed = product.quantity - currentProduced;

          if (needed > 0) {
            const take = Math.min(needed, remainingToDistribute);
            product.produced = currentProduced + take;
            remainingToDistribute -= take;
            orderUpdated = true;

            // If we distributed data, check if we exhausted our supply
            if (remainingToDistribute <= 0) break;
          }
        }
      }

      if (orderUpdated) {
        // Check if ALL products in this order are fully produced
        const allDone = order.products.every(
          (p) => (p.produced || 0) >= p.quantity
        );

        if (allDone) {
          order.productionStage = "FINISHED";
        } else {
          // If started but not finished, ensure it's IN_PROCESS
          if (order.productionStage === "PENDING") {
            order.productionStage = "IN_PROCESS";
          }
        }

        await order.save();
      }
    }

    return {
      distributed: quantityMade - remainingToDistribute,
      remaining: remainingToDistribute, // If > 0, we made more than needed!
    };
  }

  // ... Legacy summary method if needed
  async getProductionSummary(days: number = 7) {
    // (Can remain or be removed/ignored)
    return []
  }
}
