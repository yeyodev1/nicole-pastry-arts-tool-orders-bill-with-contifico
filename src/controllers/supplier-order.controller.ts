import type { Request, Response, NextFunction } from "express";
import { SupplierOrderModel } from "../models/supplier-order.model";

// --- Create Order ---
async function createOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const { provider, items, deliveryDate, user, whatsappMessage, totalEstimatedValue } = req.body;

    if (!provider || !items || !items.length || !deliveryDate || !user) {
      return res.status(400).send({ message: "Provider, items, delivery date, and user are required." });
    }

    const order = new SupplierOrderModel({
      provider,
      items,
      deliveryDate: new Date(deliveryDate),
      user,
      whatsappMessage,
      totalEstimatedValue,
      status: "PENDING",
    });

    await order.save();

    return res.status(201).send({
      message: "Supplier order created successfully.",
      order,
    });
  } catch (error) {
    console.error("Error creating supplier order:", error);
    next(error);
  }
}

// --- Get All Orders ---
async function getOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 20;
    const skip = (page - 1) * limit;

    const query: any = {};
    if (req.query.provider) query.provider = req.query.provider;
    if (req.query.status) query.status = req.query.status;

    // Date filtering for deliveryDate
    if (req.query.startDate || req.query.endDate) {
      query.deliveryDate = {};
      if (req.query.startDate) {
        query.deliveryDate.$gte = new Date(req.query.startDate as string);
      }
      if (req.query.endDate) {
        query.deliveryDate.$lte = new Date(req.query.endDate as string);
      }
    }

    const [orders, total] = await Promise.all([
      SupplierOrderModel.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("provider", "name")
        .populate("user", "name"),
      SupplierOrderModel.countDocuments(query),
    ]);

    return res.status(200).send({
      orders,
      total,
      page,
      pages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error fetching supplier orders:", error);
    next(error);
  }
}

// --- Get Order By ID ---
async function getOrderById(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const order = await SupplierOrderModel.findById(id)
      .populate("provider", "name")
      .populate("user", "name")
      .populate("items.material", "name unit");

    if (!order) {
      return res.status(404).send({ message: "Supplier order not found." });
    }

    return res.status(200).send({ order });
  } catch (error) {
    console.error("Error fetching supplier order by ID:", error);
    next(error);
  }
}

// --- Update Order ---
async function updateOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const updates = req.body;

    const order = await SupplierOrderModel.findByIdAndUpdate(id, updates, { new: true });

    if (!order) {
      return res.status(404).send({ message: "Supplier order not found." });
    }

    return res.status(200).send({
      message: "Supplier order updated successfully.",
      order,
    });
  } catch (error) {
    console.error("Error updating supplier order:", error);
    next(error);
  }
}

// --- Arriving Today (aviso "esto llega hoy") ---
async function getArrivingToday(req: Request, res: Response, next: NextFunction) {
  try {
    // Rango del día actual en hora Ecuador (UTC-5)
    const now = new Date(Date.now() - 5 * 60 * 60 * 1000);
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth();
    const d = now.getUTCDate();
    const start = new Date(Date.UTC(y, m, d, 5, 0, 0)); // 00:00 EC
    const end = new Date(Date.UTC(y, m, d + 1, 4, 59, 59, 999)); // 23:59 EC

    const orders = await SupplierOrderModel.find({
      deliveryDate: { $gte: start, $lte: end },
      status: { $in: ["PENDING", "SENT"] },
    })
      .sort({ deliveryDate: 1 })
      .populate("provider", "name phone")
      .populate("user", "name");

    return res.status(200).send({ count: orders.length, orders });
  } catch (error) {
    console.error("Error fetching arriving-today supplier orders:", error);
    next(error);
  }
}

// --- Receive Order (recepción con checklist y evidencia) ---
async function receiveOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { receivedBy, receptionNotes, invoicePhotoUrl, invoiceRef, items } = req.body;

    const order = await SupplierOrderModel.findById(id);
    if (!order) {
      return res.status(404).send({ message: "Supplier order not found." });
    }

    order.receivedAt = new Date();
    order.receivedBy = receivedBy || "Bodega";
    if (receptionNotes !== undefined) order.receptionNotes = receptionNotes;
    if (invoicePhotoUrl !== undefined) order.invoicePhotoUrl = invoicePhotoUrl;
    if (invoiceRef !== undefined) order.invoiceRef = invoiceRef;

    let hasIssues = false;
    if (Array.isArray(items)) {
      items.forEach((received: any) => {
        const item = order.items.find(
          (i: any) => i._id?.toString() === received.itemId || i.material?.toString() === received.material
        );
        if (!item) return;
        if (received.quantityReceived !== undefined) {
          item.quantityReceived = Number(received.quantityReceived);
        }
        item.itemStatus = received.itemStatus || (item.quantityReceived !== undefined && item.quantityReceived < item.quantity ? "MISSING" : "OK");
        if (received.itemNote) item.itemNote = received.itemNote;
        if (item.itemStatus !== "OK") hasIssues = true;
      });
    }

    order.receptionStatus = hasIssues ? "PROBLEM" : "RECEIVED";
    order.status = "RECEIVED";

    await order.save();

    return res.status(200).send({
      message: hasIssues
        ? "Recepción registrada con novedades."
        : "Recepción registrada correctamente.",
      order,
    });
  } catch (error) {
    console.error("Error receiving supplier order:", error);
    next(error);
  }
}

// --- Delete Order ---
async function deleteOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const order = await SupplierOrderModel.findByIdAndDelete(id);

    if (!order) {
      return res.status(404).send({ message: "Supplier order not found." });
    }

    return res.status(200).send({
      message: "Supplier order deleted successfully.",
    });
  } catch (error) {
    console.error("Error deleting supplier order:", error);
    next(error);
  }
}

export { createOrder, getOrders, getOrderById, updateOrder, deleteOrder, getArrivingToday, receiveOrder };
