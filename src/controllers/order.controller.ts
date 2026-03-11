import { Request, Response, NextFunction } from "express";
import { HttpStatusCode } from "axios";
import { models } from "../models";
import { ContificoService } from "../services/contifico.service";
import { getECDateRange } from "../utils/date.utils";
import { AuthRequest } from "../types/AuthRequest";

const contificoService = new ContificoService();

export async function createOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orderData = req.body;
    const jwtUser = req.user;

    // Fetch fresh user to avoid stale JWT issues
    let currentUser: any = jwtUser;
    if (jwtUser?.email) {
      currentUser = await models.users.findOne({ email: jwtUser.email }).lean() || jwtUser;
    }
    const currentRole = currentUser?.role?.toUpperCase();

    // Auto-populate responsible from logged-in user
    if (currentUser && (currentRole === 'SALES_REP' || currentRole === 'SALES_MANAGER' || currentRole === 'SALES')) {
      orderData.responsible = currentUser.name;
    }

    if (!orderData.responsible && currentUser) {
      orderData.responsible = currentUser.name || currentUser.email;
    }

    // Fallback if no user (should not happen with authMiddleware)
    if (!orderData.responsible) orderData.responsible = "Web";

    // 1. Basic Validation
    if (!orderData.customerName || !orderData.products || orderData.products.length === 0) {
      res.status(HttpStatusCode.BadRequest).send({
        message: "Customer name and products are required.",
      });
      return;
    }

    if (!orderData.deliveryTime) {
      res.status(HttpStatusCode.BadRequest).send({
        message: "Delivery time is required.",
      });
      return;
    }

    // Map deliveryType legacy check
    if (orderData.deliveryType === "pickup") {
      orderData.deliveryType = "retiro";
    }

    // STRICT VALIDATION: Delivery Requirements
    if (orderData.deliveryType === "delivery") {
      if (!orderData.googleMapsLink || !orderData.deliveryAddress) {
        res.status(HttpStatusCode.BadRequest).send({
          message: "For Delivery orders, Google Maps Link and Delivery Address are mandatory.",
        });
        return;
      }
    }

    // Default defaults
    if (!orderData.orderDate) orderData.orderDate = new Date();
    if (!orderData.salesChannel) orderData.salesChannel = "Web";
    if (!orderData.paymentMethod) orderData.paymentMethod = "Por confirmar";

    // Si es retiro directo de tienda, marcar como finalizado en producción
    if (orderData.skipProduction === true) {
      orderData.productionStage = "FINISHED";
    }

    // Handle Settlement in Island during creation
    if (orderData.settledInIsland && orderData.settledIslandName) {
      orderData.paymentMethod = `Isla: ${orderData.settledIslandName}`;
      orderData.paymentDetails = {
        forma_cobro: 'ISLA',
        monto: orderData.totalValue || 0,
        fecha: new Date().toISOString().split('T')[0],
        numero_comprobante: `ISLA-${orderData.settledIslandName}`
      };
    }

    // Initialize payments array if paymentDetails is present
    if (orderData.paymentDetails && orderData.paymentDetails.monto > 0) {
      orderData.payments = [{
        ...orderData.paymentDetails,
        fecha: new Date(),
        status: 'PAID'
      }];
    } else {
      orderData.payments = [];
    }

    // Calculate totalValue if missing
    if (orderData.totalValue === undefined || orderData.totalValue === null) {
      if (orderData.isGlobalCourtesy) {
        orderData.totalValue = 0;
      } else {
        const subtotal = orderData.products.reduce((sum: number, p: any) => {
          let discount = p.isCourtesy ? 100 : 0;
          if (orderData.globalDiscountPercentage > 0 && discount < 100) {
            discount = orderData.globalDiscountPercentage;
          }
          const itemTotal = (Number(p.price) * Number(p.quantity)) * ((100 - discount) / 100);
          return sum + itemTotal;
        }, 0);

        const iva = orderData.products.reduce((sum: number, p: any) => {
          let discount = p.isCourtesy ? 100 : 0;
          if (orderData.globalDiscountPercentage > 0 && discount < 100) {
            discount = orderData.globalDiscountPercentage;
          }
          const isDelivery = p.name.toLowerCase().includes('delivery');
          if (isDelivery) return sum;

          const itemTotal = (Number(p.price) * Number(p.quantity)) * ((100 - discount) / 100);
          return sum + (itemTotal * 0.15);
        }, 0);

        orderData.totalValue = Number((subtotal + iva).toFixed(2));
      }
    }

    // Auto-populate deliveryValue if it's 0 but there's a "Delivery" product
    if (!orderData.deliveryValue || orderData.deliveryValue === 0) {
      const deliveryProduct = orderData.products.find((p: any) =>
        p.name.toLowerCase().includes("delivery") || p.name.toLowerCase().includes("envío")
      );
      if (deliveryProduct) {
        orderData.deliveryValue = Number(deliveryProduct.price) * Number(deliveryProduct.quantity);
        // Also ensure deliveryType is set to delivery if we found a delivery fee
        if (orderData.deliveryType !== "delivery") {
          orderData.deliveryType = "delivery";
        }
      }
    }

    // 2. Save Order to Database
    const newOrder = new models.orders(orderData);
    await newOrder.save();

    // 3. Generate WhatsApp Message (Strict Format)
    /*
      CONFIRMACIÓN DE PEDIDO - NICOLE PASTRY
      Tipo de Orden: [Ej: Delivery saliendo de Ceibos]
      Cliente: [Nombre]
      Cédula/RUC: [Dato]
      Correo: [Dato]
      Celular: [Dato]
      Fecha de Entrega: [DD/MM/AAAA]
      Hora de Entrega/Retiro: [Hora solicitada por cliente]
      Items (Nombre Contífico):
      [Cantidad] x [Nombre Exacto en Contífico]
      Dirección de Entrega: [Texto]
      Link Maps: [Pegar Link Aquí]
    */

    const productsString = orderData.products
      .map((p: any) => `${p.quantity} x ${p.name}`)
      .join("\n");

    const deliveryDateFormatted = new Date(orderData.deliveryDate).toLocaleDateString('es-EC');

    // Construct "Type of Order" string
    // e.g. "Delivery saliendo de Ceibos" or "Retiro en local - San Marino"
    let typeOfOrder = "";
    if (orderData.skipProduction) {
      typeOfOrder = `Retiro directo de tienda - ${orderData.exitPoint || orderData.branch || 'S/N'}`;
    } else if (orderData.deliveryType === 'retiro') {
      typeOfOrder = `Retiro en local - ${orderData.branch || 'S/N'}`;
    } else {
      typeOfOrder = `Delivery saliendo de - ${orderData.branch || 'S/N'}`;
    }

    const whatsappMessage = `
CONFIRMACIÓN DE PEDIDO - NICOLE PASTRY

Tipo de Orden: ${typeOfOrder}

Cliente: ${orderData.customerName}

Cédula/RUC: ${orderData.invoiceData?.ruc || "N/A"}

Correo: ${orderData.invoiceData?.email || "N/A"}

Celular: ${orderData.customerPhone}

Fecha de Entrega: ${deliveryDateFormatted}

Hora de Entrega/Retiro: ${orderData.deliveryTime}

Items (Nombre Contífico):

${productsString}

Dirección de Entrega: ${orderData.deliveryType === 'delivery' ? orderData.deliveryAddress : 'N/A (Retiro)'}

Link Maps: ${orderData.googleMapsLink || 'N/A'}

Motorizado: ${orderData.deliveryPerson?.name || 'Por asignar'}
Valor Envío: $${orderData.deliveryValue || 0}
    `.trim();

    // 4. Send Response
    res.status(HttpStatusCode.Created).send({
      message: "Order created successfully.",
      order: newOrder,
      whatsappMessage
    });
    return;
  } catch (error) {
    console.error("❌ Error in createOrder:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Internal server error occurred while creating order.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

/**
 * Get all orders with optional filtering
 */
export async function getOrders(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { search, startDate, endDate } = req.query;
    const jwtUser = req.user;

    // Fetch fresh user to avoid stale JWT issues
    let currentUser: any = jwtUser;
    if (jwtUser?.email) {
      currentUser = await models.users.findOne({ email: jwtUser.email }).lean() || jwtUser;
    }
    const currentRole = currentUser?.role?.toUpperCase();

    const query: any = {};

    // Data Isolation for Sales Reps
    if (currentUser && (currentRole === 'SALES_REP' || currentRole === 'SALES')) {
      if (currentUser.name) {
        query.responsible = { $regex: new RegExp(`^${currentUser.name}$`, "i") };
      }
    }

    // 1. Search Filter (Name, RUC, Email)
    if (search) {
      const searchRegex = new RegExp(String(search), 'i');
      query.$or = [
        { customerName: searchRegex },
        { "invoiceData.ruc": searchRegex },
        { "invoiceData.email": searchRegex }
      ];
    }

    // Date Filters
    if (startDate || endDate) {
      const dateType = req.query.dateType as string;
      const dateField = dateType === 'createdAt' ? 'createdAt' : 'deliveryDate';
      const isFullTimestamp = dateField === 'createdAt';
      query[dateField] = {};

      if (startDate) {
        const s = String(startDate);
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
          const { startDate: startRange } = getECDateRange(s, isFullTimestamp);
          query[dateField].$gte = startRange;
        } else {
          query[dateField].$gte = new Date(s);
        }
      }
      if (endDate) {
        const e = String(endDate);
        if (/^\d{4}-\d{2}-\d{2}$/.test(e)) {
          const { endDate: endRange } = getECDateRange(e, isFullTimestamp);
          query[dateField].$lte = endRange;
        } else {
          const eDate = new Date(e);
          eDate.setHours(23, 59, 59, 999);
          query[dateField].$lte = eDate;
        }
      }
    }

    // 3. Invoice Status Filter (ERROR, PENDING, PROCESSED)
    if (req.query.invoiceStatus) {
      if (req.query.invoiceStatus === 'UNBILLED') {
        query.invoiceStatus = { $ne: 'PROCESSED' };
      } else {
        query.invoiceStatus = req.query.invoiceStatus;
      }
    }

    // 4. Dispatch Status Filter (e.g. RETURNED)
    if (req.query.dispatchStatus) {
      query.dispatchStatus = req.query.dispatchStatus;
    }

    // 3. Execution
    // If we have filters, we might want to return more than 100, or just default to a larger number.
    // For now, let's keep a limit but make it larger if searching.
    const limit = (search || startDate || endDate) ? 500 : 100;
    const sortField = req.query.dateType === 'createdAt' ? 'createdAt' : 'deliveryDate';

    const orders = await models.orders
      .find(query)
      .sort({ [sortField]: -1, createdAt: -1 }) // Sort by selected date field primarily
      .limit(limit);

    res.status(HttpStatusCode.Ok).send(orders);
    return;
  } catch (error) {
    console.error("❌ Error in getOrders:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Internal server error while fetching orders.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

/**
 * Get single order by ID
 */
export async function getOrderById(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const order = await models.orders.findById(id);

    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ message: "Order not found" });
      return;
    }

    res.status(HttpStatusCode.Ok).send(order);
    return;
  } catch (error) {
    console.error("❌ Error in getOrderById:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Internal server error while fetching order.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

/**
 * Get invoice processing status (counts of pending and error orders)
 * GET /api/orders/invoice-status
 */
export async function getInvoiceStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const [pending, error, processed, errorOrders] = await Promise.all([
      models.orders.countDocuments({ invoiceNeeded: true, invoiceStatus: "PENDING" }),
      models.orders.countDocuments({ invoiceNeeded: true, invoiceStatus: "ERROR" }),
      models.orders.countDocuments({ invoiceStatus: "PROCESSED" }),
      models.orders.find(
        { invoiceNeeded: true, invoiceStatus: "ERROR" },
        { _id: 1, customerName: 1, invoiceError: 1, invoiceData: 1, deliveryDate: 1 }
      ).sort({ updatedAt: -1 }).limit(50).lean(),
    ]);

    res.status(HttpStatusCode.Ok).send({ pending, error, processed, errorOrders });
    return;
  } catch (err) {
    res.status(HttpStatusCode.InternalServerError).send({ message: "Error fetching invoice status" });
    return;
  }
}

/**
 * Process all pending (and errored) invoices
 * Called by GitHub Actions cron — protected by CRON_SECRET
 */
export async function processPendingInvoices(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // ── Auth: validate CRON_SECRET ──────────────────────────────────────────
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const authHeader = req.headers["authorization"] || "";
      const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
      if (token !== cronSecret) {
        res.status(HttpStatusCode.Unauthorized).send({ message: "Unauthorized." });
        return;
      }
    }

    // ── Batch config ────────────────────────────────────────────────────────
    // Process PENDING first, then ERROR (retries). 5 orders per batch.
    const BATCH_SIZE = 5;

    // Count actionable orders: PENDING + ERROR
    const totalPending = await models.orders.countDocuments({
      invoiceNeeded: true,
      invoiceStatus: { $in: ["PENDING", "ERROR"] }
    });

    if (totalPending === 0) {
      res.status(HttpStatusCode.Ok).send({ message: "No pending invoices found.", remaining: 0 });
      return;
    }

    // PENDING orders take priority over ERROR retries
    const pendingOrders = await models.orders.find({
      invoiceNeeded: true,
      invoiceStatus: { $in: ["PENDING", "ERROR"] }
    })
      .sort({ invoiceStatus: -1 }) // "PENDING" > "ERROR" alphabetically → PENDING first
      .limit(BATCH_SIZE);


    const results = {
      processed: 0,
      failed: 0,
      errors: [] as any[]
    };

    for (const order of pendingOrders) {
      try {

        // 1. Ensure client exists or create it (handled by logic if needed, but assuming data is ready)
        // Note: ContificoService.createInvoice creates the client if needed implicitly via the payload structure? 
        // Actually earlier we modified createPerson, but createInvoice also sends client data.

        // 2. Create Invoice
        const invoiceResponse = await contificoService.createInvoice(order);

        // 3. Update Order
        if (invoiceResponse.error) {
          const errorMsg = typeof invoiceResponse.error === 'object'
            ? JSON.stringify(invoiceResponse.error)
            : String(invoiceResponse.error);
          throw new Error(errorMsg);
        }

        order.invoiceStatus = "PROCESSED";
        order.invoiceInfo = invoiceResponse;
        await order.save();

        // 3.1 Trigger SRI Authorization (Manual Trigger Feature)
        try {
          // We call this immediately so the user doesn't have to wait for the Contífico hourly script
          await contificoService.sendToSri(invoiceResponse.id);
        } catch (sriError) {
          console.warn(`⚠️ Failed to trigger SRI for order ${order._id} (non-blocking)`);
        }

        // 4. Register Collection AUTOMATICALLY if payment details exist
        // SKIP if it's Credit (CR)
        if (order.paymentDetails && order.paymentDetails.monto && order.paymentDetails.forma_cobro !== 'CR') {
          try {

            // Fix Bank ID if needed for existing bad data
            const collectionPayload = {
              ...order.paymentDetails,
              monto: invoiceResponse.total, // FORCE MATCH: Pay exactly what the invoice says
              cuenta_bancaria_id: resolveBankId(order.paymentDetails.cuenta_bancaria_id)
            };

            await contificoService.registerCollection(invoiceResponse.id, collectionPayload);
          } catch (collectionError: any) {
            console.error(`⚠️ Failed to register automatic collection for order ${order._id}:`, collectionError.message);
            // We don't fail the invoice process, just log it. 
            // Ideally we might want to flag the order as "INVOICED_BUT_PAYMENT_FAILED" or similar.
            // For now, logging is sufficient as admin can retry manually via UI.
          }
        }

        results.processed++;
      } catch (error: any) {
        console.error(`❌ Failed to invoice order ${order._id}:`, error.message);
        order.invoiceStatus = "ERROR";
        order.invoiceError = error.message;
        await order.save();

        results.failed++;
        results.errors.push({
          orderId: order._id,
          error: error.message
        });
      }
    }

    // Re-count remaining after processing (accurate for loop control)
    const remaining = await models.orders.countDocuments({
      invoiceNeeded: true,
      invoiceStatus: { $in: ["PENDING", "ERROR"] }
    });

    console.log(`[batch-invoice] Batch done. Processed: ${results.processed}, Failed: ${results.failed}, Remaining: ${remaining}`);

    res.status(HttpStatusCode.Ok).send({
      message: `Batch processed. ${remaining} invoices remaining.`,
      results,
      remaining,
      totalPending
    });
    return;

  } catch (error) {
    console.error("❌ Error in processPendingInvoices:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Internal server error during batch processing.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

/**
 * Update invoice data for an existing order
 * Allowed only if invoiceStatus is 'PENDING'
 */
export async function updateInvoiceData(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { invoiceNeeded, invoiceData } = req.body;

    const order = await models.orders.findById(id);

    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ message: "Order not found." });
      return;
    }

    // Block edits if already processed
    if (order.invoiceStatus === "PROCESSED") {
      res.status(HttpStatusCode.BadRequest).send({
        message: "Cannot edit invoice data. Invoice has already been processed with Contífico."
      });
      return;
    }

    // Update fields
    if (invoiceNeeded !== undefined) order.invoiceNeeded = invoiceNeeded;
    if (invoiceData) order.invoiceData = invoiceData;

    // Reset status to PENDING if it was ERROR, so it gets picked up again
    if (order.invoiceNeeded) {
      order.invoiceStatus = "PENDING";
      order.invoiceError = undefined; // Clear previous error when data is corrected
    } else {
      order.invoiceStatus = undefined;
      order.invoiceError = undefined;
    }

    await order.save();

    res.status(HttpStatusCode.Ok).send({
      message: "Order invoice data updated successfully.",
      order
    });
    return;
  } catch (error) {
    console.error("❌ Error in updateInvoiceData:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Internal server error while updating order.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

/**
 * Update an existing order (Generic)
 * PUT /api/orders/:id
 */
export async function updateOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const order = await models.orders.findById(id);

    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ message: "Order not found." });
      return;
    }

    // Update recursively or specifically
    if (updateData.deliveryPerson) order.deliveryPerson = updateData.deliveryPerson;
    if (updateData.deliveryValue !== undefined) order.deliveryValue = updateData.deliveryValue;
    if (updateData.deliveryType) order.deliveryType = updateData.deliveryType;
    if (updateData.branch) order.branch = updateData.branch;
    if (updateData.comments) order.comments = updateData.comments;
    if (updateData.customerName) order.customerName = updateData.customerName;
    if (updateData.customerPhone) order.customerPhone = updateData.customerPhone;
    if (updateData.deliveryAddress) order.deliveryAddress = updateData.deliveryAddress;
    if (updateData.googleMapsLink) order.googleMapsLink = updateData.googleMapsLink;

    // Fix: Missing Date Fields
    if (updateData.deliveryDate) order.deliveryDate = updateData.deliveryDate;
    if (updateData.deliveryTime) order.deliveryTime = updateData.deliveryTime;
    if (updateData.orderDate) order.orderDate = updateData.orderDate;


    // NEW: Allow updating core order data (products, payments)
    if (updateData.products) order.products = updateData.products;
    if (updateData.totalValue !== undefined) order.totalValue = updateData.totalValue;

    // Payment updates
    if (updateData.paymentDetails) order.paymentDetails = updateData.paymentDetails;
    if (updateData.payments) order.payments = updateData.payments;
    if (updateData.paymentMethod) order.paymentMethod = updateData.paymentMethod;

    // Invoice Data updates (if not processed)
    if (order.invoiceStatus !== 'PROCESSED') {
      if (updateData.invoiceNeeded !== undefined) order.invoiceNeeded = updateData.invoiceNeeded;
      if (updateData.invoiceData) order.invoiceData = updateData.invoiceData;
    }

    // Settlement updates
    if (updateData.settledInIsland !== undefined) order.settledInIsland = updateData.settledInIsland;
    if (updateData.settledIslandName) order.settledIslandName = updateData.settledIslandName;

    await order.save();

    res.status(HttpStatusCode.Ok).send({
      message: "Order updated successfully.",
      order
    });
    return;
  } catch (error) {
    console.error("❌ Error in updateOrder:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Internal server error while updating order.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

// Helper to map bank names to Contífico IDs
function resolveBankId(inputName: string | undefined): string {
  if (!inputName) return "";

  const normalized = inputName.toLowerCase().trim();
  const map: { [key: string]: string } = {
    'banco guayaquil': 'RYWb4RPQcx81eZ1m',
    'guayaquil': 'RYWb4RPQcx81eZ1m',
    'banco pichincha': 'wy7aANAJs5RWbgZY',
    'pichincha': 'wy7aANAJs5RWbgZY',
    'banco bolivariano': 'lwKe5QQMI1lGe31R',
    'bolivariano': 'lwKe5QQMI1lGe31R'
  };

  return map[normalized] || inputName;
}

/**
 * Register a collection (cobro) for an order
 * POST /api/orders/:id/collection
 */
export async function registerCollection(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const collectionData = req.body;

    // 1. Validate Order
    const order = await models.orders.findById(id);
    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ message: "Order not found." });
      return;
    }

    // 2. Validate Payment Overflows
    // 2. Validate Payment Overflows
    const currentPaid = (order.payments || []).reduce((sum, p) => sum + (p.monto || 0), 0);
    const newAmount = Number(collectionData.monto);

    // SELF-HEALING: If totalValue is 0 (legacy/bug), recalculate from products
    let effectiveTotal = order.totalValue;
    if (!effectiveTotal || effectiveTotal === 0) {
      effectiveTotal = order.products.reduce((sum: number, p: any) => {
        if (p.isCourtesy) return sum;
        return sum + (Number(p.price) * Number(p.quantity));
      }, 0);

      if (effectiveTotal > 0) {
        order.totalValue = effectiveTotal;
        // Will be saved below with order.save()
      }
    }

    // Allow small Floating Point tolerance
    if ((currentPaid + newAmount) > (effectiveTotal + 0.10)) { // 10 cents tolerance
      res.status(HttpStatusCode.BadRequest).send({
        message: `Payment exceeds total order value. Total: ${effectiveTotal}, Paid: ${currentPaid}, Attempting: ${newAmount}`
      });
      return;
    }

    // 3. Resolve Bank ID
    if (collectionData.cuenta_bancaria_id) {
      collectionData.cuenta_bancaria_id = resolveBankId(collectionData.cuenta_bancaria_id);
    }

    // Update Legacy Field (Last Payment)
    if (!order.paymentDetails) order.paymentDetails = {} as any;
    order.paymentDetails = {
      ...order.paymentDetails,
      ...collectionData
    };

    // Push to Payments Array
    if (!order.payments) order.payments = [];
    order.payments.push({
      ...collectionData,
      fecha: new Date(),
      status: 'PAID'
    });

    // Also update top-level paymentMethod string if coming from UI mapping
    if (collectionData.forma_cobro) {
      // Map code to label for display
      const methodMap: any = { 'TRA': 'Transferencia', 'TC': 'Tarjeta', 'CR': 'Crédito' };
      // Only update if it's the first payment or explicit override? 
      // Let's just update the label to reflect the latest method used.
      order.paymentMethod = methodMap[collectionData.forma_cobro] || order.paymentMethod;
    }

    await order.save();

    // 4. Check Invoice Existence
    const documentId = order.invoiceInfo?.id;

    if (!documentId) {
      // Offline/Queued Mode
      // Ensure invoiceNeeded is true so batch picks it up
      if (!order.invoiceNeeded) {
        order.invoiceNeeded = true;
        order.invoiceStatus = "PENDING";
        await order.save();
      }

      res.status(HttpStatusCode.Ok).send({
        message: "Payment registered locally. Will be synced to Contífico when invoice is generated.",
        localOnly: true,
        order
      });
      return;
    }

    // 5. Register Collection in Contífico (Immediate Mode)
    // SKIP Contífico for Credit payments (CR)
    if (collectionData.forma_cobro === 'CR') {
      res.status(HttpStatusCode.Created).send({
        message: "Payment registered as Credit (Internal).",
        localOnly: true,
        order
      });
      return;
    }

    const payloadToSend = {
      ...collectionData,
      cuenta_bancaria_id: collectionData.cuenta_bancaria_id
    };

    const result = await contificoService.registerCollection(documentId, payloadToSend);

    res.status(HttpStatusCode.Created).send({
      message: "Collection registered successfully in Contífico.",
      result,
      order
    });

  } catch (error: any) {
    console.error("❌ Error registering collection:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Failed to register collection.",
      error: error.message || String(error)
    });
  }
}



/**
 * Manually trigger invoice generation for a specific order
 * POST /api/orders/:id/invoice/generate
 */
export async function generateInvoice(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const order = await models.orders.findById(id);

    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ message: "Order not found." });
      return;
    }

    if (order.invoiceStatus === "PROCESSED") {
      res.status(HttpStatusCode.BadRequest).send({ message: "Invoice already processed." });
      return;
    }

    if (!order.invoiceNeeded) {
      order.invoiceNeeded = true;
    }


    // Create Invoice
    const invoiceResponse = await contificoService.createInvoice(order);

    if (invoiceResponse.error) {
      // Extract human-readable message from Contifico's error response
      let contificoMensaje = '';
      const rawError = invoiceResponse.error;

      if (typeof rawError === 'object' && rawError !== null) {
        contificoMensaje = rawError.mensaje || JSON.stringify(rawError);
      } else if (typeof rawError === 'string') {
        try {
          const parsed = JSON.parse(rawError);
          contificoMensaje = parsed.mensaje || rawError;
        } catch {
          contificoMensaje = rawError;
        }
      }

      const err = new Error(contificoMensaje) as any;
      err.isContificoError = true;
      throw err;
    }

    // Update Order
    order.invoiceStatus = "PROCESSED";
    order.invoiceInfo = invoiceResponse;
    await order.save();

    // Trigger SRI (Non-blocking)
    contificoService.sendToSri(invoiceResponse.id).catch(err => console.error("SRI Error:", err));

    // Auto-Register Collection if exists
    // SKIP if it's Credit (CR)
    if (order.paymentDetails && order.paymentDetails.monto && order.paymentDetails.forma_cobro !== 'CR') {
      try {
        const collectionPayload = {
          ...order.paymentDetails,
          monto: invoiceResponse.total,
          cuenta_bancaria_id: resolveBankId(order.paymentDetails.cuenta_bancaria_id)
        };
        await contificoService.registerCollection(invoiceResponse.id, collectionPayload);
      } catch (err) {
        console.error("Auto-collection error:", err);
      }
    }

    res.status(HttpStatusCode.Ok).send({
      message: "Invoice generated successfully.",
      order
    });
    return;

  } catch (error: any) {
    console.error("Error generating invoice:", error);

    try {
      await models.orders.findByIdAndUpdate(req.params.id, { invoiceStatus: 'ERROR', invoiceError: error.message });
    } catch (e) { }

    const contificoMessage = error.isContificoError ? error.message : null;

    res.status(HttpStatusCode.InternalServerError).send({
      message: contificoMessage
        ? `Error de Contífico: ${contificoMessage}`
        : "Error al generar la factura.",
      contificoMessage: contificoMessage || null,
      error: error.message || String(error)
    });
    return;
  }
}

/**
 * Get Invoice PDF Link
 * GET /api/orders/:id/invoice-pdf
 */
export async function getInvoicePdf(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const order = await models.orders.findById(id);

    if (!order || !order.invoiceInfo?.id) {
      res.status(HttpStatusCode.NotFound).send({ message: "Invoice not found for this order." });
      return;
    }

    const doc = await contificoService.getDocument(order.invoiceInfo.id);

    res.status(HttpStatusCode.Ok).send({
      message: "Invoice retrieved",
      document: doc
    });
    return;

  } catch (error: any) {
    console.error("Error fetching invoice PDF:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Failed to fetch invoice PDF",
      error: error.message
    });
    return;
  }
}

/**
 * GET /api/orders/:id/invoice/auth-status
 * Returns the SRI authorization estado of the Contífico document.
 */
export async function getInvoiceAuthStatus(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const order = await models.orders.findById(id);

    if (!order || !order.invoiceInfo?.id) {
      res.status(HttpStatusCode.NotFound).send({ message: "No invoice found for this order." });
      return;
    }

    const estado = await contificoService.getDocumentEstado(order.invoiceInfo.id);
    res.status(HttpStatusCode.Ok).send(estado);
    return;
  } catch (error: any) {
    console.error("Error fetching invoice auth status:", error);
    res.status(HttpStatusCode.InternalServerError).send({ message: error.message });
    return;
  }
}

/**
 * POST /api/orders/:id/invoice/authorize
 * Re-triggers sending the Contífico document to SRI for authorization.
 */
export async function triggerInvoiceAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const order = await models.orders.findById(id);

    if (!order || !order.invoiceInfo?.id) {
      res.status(HttpStatusCode.NotFound).send({ message: "No invoice found for this order." });
      return;
    }

    const result = await contificoService.sendToSri(order.invoiceInfo.id);
    res.status(HttpStatusCode.Ok).send({ message: "Autorización enviada al SRI.", result });
    return;
  } catch (error: any) {
    console.error("Error triggering invoice auth:", error);
    res.status(HttpStatusCode.InternalServerError).send({ message: error.message });
    return;
  }
}

/**
 * Settle an order in a physical island (Branch)
 * Marks it as settled locally and registers an 'ISLA' payment.
 */
export async function settleOrderInIsland(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { islandName } = req.body;

    if (!islandName) {
      res.status(HttpStatusCode.BadRequest).send({ message: "Island name is required." });
      return;
    }

    const order = await models.orders.findById(id);

    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ message: "Order not found." });
      return;
    }

    // 1. Update settlement fields
    order.settledInIsland = true;
    order.settledIslandName = islandName;

    // 2. Add 'ISLA' payment to mark as "Paid" in the system
    // We add it to the payments array and update paymentMethod
    const amountToSettle = order.totalValue;

    order.payments.push({
      forma_cobro: 'ISLA',
      monto: amountToSettle,
      fecha: new Date(),
      reference: `Settled in ${islandName}`,
      status: 'PAID'
    });

    // Update paymentMethod for summary
    order.paymentMethod = `Isla: ${islandName}`;

    // Update paymentDetails for list view legacy check (if still used)
    if (!order.paymentDetails?.monto) {
      order.paymentDetails = {
        forma_cobro: 'ISLA',
        monto: amountToSettle,
        fecha: new Date().toISOString().split('T')[0],
        numero_comprobante: `ISLA-${islandName}`
      };
    }

    await order.save();

    res.status(HttpStatusCode.Ok).send({
      message: "Order settled in island successfully.",
      order
    });
    return;
  } catch (error) {
    console.error("Error settling order in island:", error);
    res.status(HttpStatusCode.InternalServerError).send({ message: "Internal Server Error" });
    return;
  }
}

/**
 * Get delivery report with totals and grouped data
 * GET /api/orders/reports/delivery
 */
export async function getDeliveryReport(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { startDate, endDate, deliveryPersonId, page = "1", limit = "10" } = req.query;

    if (!startDate || !endDate) {
      res.status(HttpStatusCode.BadRequest).send({
        message: "startDate and endDate are required parameters (YYYY-MM-DD)."
      });
      return;
    }

    const pageNumber = parseInt(page as string, 10) || 1;
    const limitNumber = parseInt(limit as string, 10) || 10;
    const skip = (pageNumber - 1) * limitNumber;

    const query: any = {
      deliveryDate: {
        $gte: new Date(`${startDate}T00:00:00.000Z`),
        $lte: new Date(`${endDate}T23:59:59.999Z`)
      }
    };

    if (deliveryPersonId) {
      query["deliveryPerson.personId"] = deliveryPersonId;
    }

    const allOrders = await models.orders.find(query)
      .select("orderDate deliveryDate customerName deliveryValue deliveryPerson totalValue status products deliveryType")
      .sort({ deliveryDate: 1 });

    // Filter and map orders to include those that either have a deliveryValue OR a "Delivery" product
    const orders = allOrders.map(o => {
      let finalDeliveryValue = o.deliveryValue || 0;

      // Fallback: If deliveryValue is 0, check products for "Delivery"
      if (finalDeliveryValue === 0 && o.products) {
        const deliveryProduct = o.products.find((p: any) =>
          p.name.toLowerCase().includes("delivery") || p.name.toLowerCase().includes("envío")
        );
        if (deliveryProduct) {
          finalDeliveryValue = deliveryProduct.price * deliveryProduct.quantity;
        }
      }

      return {
        ...o.toObject(),
        deliveryValue: finalDeliveryValue
      };
    }).filter(o => o.deliveryValue > 0 || o.deliveryType === 'delivery');

    const total = orders.reduce((sum, o) => sum + (o.deliveryValue || 0), 0);

    // Grouping by delivery person for extra clarity
    const summaryByPerson = orders.reduce((acc: any, o: any) => {
      const personName = o.deliveryPerson?.name || "Sin asignar";
      if (!acc[personName]) {
        acc[personName] = { name: personName, total: 0, count: 0 };
      }
      acc[personName].total += (o.deliveryValue || 0);
      acc[personName].count += 1;
      return acc;
    }, {});

    const paginatedOrders = orders.slice(skip, skip + limitNumber);
    const totalPages = Math.ceil(orders.length / limitNumber) || 1;

    res.status(HttpStatusCode.Ok).send({
      message: "Delivery report retrieved successfully.",
      data: {
        total: Number(total.toFixed(2)),
        count: orders.length, // total items in date range
        totalPages,
        currentPage: pageNumber,
        summary: Object.values(summaryByPerson),
        orders: paginatedOrders // only return this page's items
      }
    });
    return;
  } catch (error) {
    console.error("❌ Error in getDeliveryReport:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Error generating delivery report.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

/**
 * Bulk assign multiple orders to a delivery person
 * POST /api/orders/bulk-assign
 */
export async function bulkAssignOrders(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { orderIds, deliveryPerson } = req.body;

    if (!Array.isArray(orderIds) || orderIds.length === 0) {
      res.status(HttpStatusCode.BadRequest).send({ message: "No order IDs provided." });
      return;
    }

    // Prepare update object
    const update = {
      deliveryPerson: deliveryPerson || null, // null removes assignment
    };

    const result = await models.orders.updateMany(
      { _id: { $in: orderIds } },
      { $set: update }
    );

    res.status(HttpStatusCode.Ok).send({
      message: `${result.modifiedCount} orders updated successfully.`,
      modifiedCount: result.modifiedCount
    });
    return;
  } catch (error) {
    console.error("❌ Error in bulkAssignOrders:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Error bulk assigning orders.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

/**
 * Reassign all orders from one delivery person to another (or unassign)
 * POST /api/orders/reassign-delivery
 */
export async function reassignDelivery(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { oldPersonId, newPerson } = req.body;

    if (!oldPersonId) {
      res.status(HttpStatusCode.BadRequest).send({ message: "Old Person ID is required." });
      return;
    }

    const update = {
      deliveryPerson: newPerson || null
    };

    const result = await models.orders.updateMany(
      { "deliveryPerson.personId": oldPersonId },
      { $set: update }
    );

    res.status(HttpStatusCode.Ok).send({
      message: `${result.modifiedCount} orders reassigned successfully.`,
      modifiedCount: result.modifiedCount
    });
    return;
  } catch (error) {
    console.error("❌ Error in reassignDelivery:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Error reassigning delivery.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

/**
 * Return an order (Devolución)
 * PUT /api/orders/:id/return
 */
export async function returnOrder(req: AuthRequest, res: Response) {
  try {
    const { id } = req.params;
    const { notes, reportedBy } = req.body;

    if (!notes) {
      res.status(HttpStatusCode.BadRequest).send({ message: "Reason for return (notes) is required." });
      return;
    }

    // Direct instantiation or use dependency injection if available
    const productionService = new (require("../services/production.service").ProductionService)();

    // Check if order exists first? Service handles it.
    // Call service
    await productionService.returnOrder(id, {
      notes,
      reportedBy: reportedBy || "Ventas/Web"
    });

    res.status(HttpStatusCode.Ok).send({
      message: "Order returned successfully."
    });

  } catch (error: any) {
    console.error("Error returning order:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Failed to return order.",
      error: error.message
    });
  }
}

/**
 * Delete an order permanently
 * DELETE /api/orders/:id
 */
export async function deleteOrder(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const order = await models.orders.findById(id);

    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ message: "Order not found." });
      return;
    }

    // SAFETY CHECK: Prevent deletion if already invoiced in Contífico
    if (order.invoiceStatus === "PROCESSED") {
      res.status(HttpStatusCode.BadRequest).send({
        message: "Cannot delete order. It has a processed invoice in Contífico. Void the invoice first if required."
      });
      return;
    }

    await models.orders.findByIdAndDelete(id);

    res.status(HttpStatusCode.Ok).send({
      message: "Order deleted successfully."
    });
    return;
  } catch (error) {
    console.error("❌ Error in deleteOrder:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Internal server error while deleting order.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}
