import type { Request, Response, NextFunction } from "express";
import { HttpStatusCode } from "axios";
import { models } from "../models";
import { ContificoService } from "../services/contifico.service";

const contificoService = new ContificoService();

export async function createOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const orderData = req.body;

    // 1. Basic Validation
    if (!orderData.customerName || !orderData.products || orderData.products.length === 0) {
      res.status(400).send({
        message: "Customer name and products are required.",
      });
      return;
    }

    if (!orderData.deliveryTime) {
      res.status(400).send({
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
        res.status(400).send({
          message: "For Delivery orders, Google Maps Link and Delivery Address are mandatory.",
        });
        return;
      }
    }

    // Default defaults
    if (!orderData.orderDate) orderData.orderDate = new Date();
    if (!orderData.salesChannel) orderData.salesChannel = "Web";
    if (!orderData.responsible) orderData.responsible = "Web";
    if (!orderData.paymentMethod) orderData.paymentMethod = "Por confirmar";

    // Calculate totalValue if missing
    if (orderData.totalValue === undefined || orderData.totalValue === null) {
      const calculatedTotal = orderData.products.reduce((sum: number, p: any) => {
        return sum + (Number(p.price) * Number(p.quantity));
      }, 0);
      orderData.totalValue = calculatedTotal;
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
    if (orderData.deliveryType === 'retiro') {
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
    `.trim();

    // 4. Send Response
    res.status(201).send({
      message: "Order created successfully.",
      order: newOrder,
      whatsappMessage
    });
    return;
  } catch (error) {
    console.error("❌ Error in createOrder:", error);
    res.status(500).send({
      message: "Internal server error occurred while creating order.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

/**
 * Get all orders
 */
export async function getOrders(req: Request, res: Response, next: NextFunction) {
  try {
    const orders = await models.orders.find().sort({ createdAt: -1 }).limit(100);
    res.status(200).send(orders);
    return;
  } catch (error) {
    console.error("❌ Error in getOrders:", error);
    res.status(500).send({
      message: "Internal server error while fetching orders.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

/**
 * Get single order by ID
 */
export async function getOrderById(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const order = await models.orders.findById(id);

    if (!order) {
      res.status(404).send({ message: "Order not found" });
      return;
    }

    res.status(200).send(order);
    return;
  } catch (error) {
    console.error("❌ Error in getOrderById:", error);
    res.status(500).send({
      message: "Internal server error while fetching order.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

/**
 * Process all pending invoices for the day
 * This should be called by a CRON job at 11:59 PM
 */
export async function processPendingInvoices(req: Request, res: Response, next: NextFunction) {
  try {
    console.log("⏰ Starting batch invoice processing...");

    // Find all orders with invoiceNeeded: true AND invoiceStatus: 'PENDING'
    // BATCH LIMIT: Process 5 at a time to avoid Vercel Timeouts (10s limit on free tier)
    const BATCH_SIZE = 5;

    // Check total pending count first
    const totalPending = await models.orders.countDocuments({
      invoiceNeeded: true,
      invoiceStatus: "PENDING"
    });

    if (totalPending === 0) {
      console.log("✅ No pending invoices to process.");
      res.status(200).send({ message: "No pending invoices found.", remaining: 0 });
      return;
    }

    const pendingOrders = await models.orders.find({
      invoiceNeeded: true,
      invoiceStatus: "PENDING"
    }).limit(BATCH_SIZE);

    console.log(`📦 Processing batch of ${pendingOrders.length} invoices. (${totalPending} total pending)`);

    const results = {
      processed: 0,
      failed: 0,
      errors: [] as any[]
    };

    for (const order of pendingOrders) {
      try {
        console.log(`Processing invoice for order ${order._id}...`);

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
        order.invoiceInfo = invoiceResponse; // Save the invoice details
        order.invoiceInfo = invoiceResponse; // Save the invoice details
        await order.save();

        // 3.1 Trigger SRI Authorization (Manual Trigger Feature)
        try {
          // We call this immediately so the user doesn't have to wait for the Contífico hourly script
          await contificoService.sendToSri(invoiceResponse.id);
        } catch (sriError) {
          console.warn(`⚠️ Failed to trigger SRI for order ${order._id} (non-blocking)`);
        }

        // 4. Register Collection AUTOMATICALLY if payment details exist
        if (order.paymentDetails && order.paymentDetails.monto) {
          try {
            console.log(`💰 Registering automatic collection for order ${order._id}...`);

            // Fix Bank ID if needed for existing bad data
            const collectionPayload = {
              ...order.paymentDetails,
              monto: invoiceResponse.total, // FORCE MATCH: Pay exactly what the invoice says
              cuenta_bancaria_id: resolveBankId(order.paymentDetails.cuenta_bancaria_id)
            };

            await contificoService.registerCollection(invoiceResponse.id, collectionPayload);
            console.log(`✅ Automatic collection registered for order ${order._id}`);
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
        await order.save();

        results.failed++;
        results.errors.push({
          orderId: order._id,
          error: error.message
        });
      }
    }

    // Calculate remaining (approximate)
    const remaining = Math.max(0, totalPending - pendingOrders.length);

    res.status(200).send({
      message: `Batch processed. ${remaining} pending invoices remaining.`,
      results,
      remaining,
      totalPending
    });
    return;

  } catch (error) {
    console.error("❌ Error in processPendingInvoices:", error);
    res.status(500).send({
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
export async function updateInvoiceData(req: Request, res: Response, next: NextFunction) {
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
    } else {
      order.invoiceStatus = undefined; // Clear status if no longer needed
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
export async function registerCollection(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const collectionData = req.body;

    // 1. Validate Order
    const order = await models.orders.findById(id);
    if (!order) {
      res.status(HttpStatusCode.NotFound).send({ message: "Order not found." });
      return;
    }

    // 2. Always Save Payment Details locally first (for batch processing)
    if (!order.paymentDetails) {
      order.paymentDetails = {} as any; // Initialize if missing
    }

    // FIX: Resolve Bank ID before saving
    if (collectionData.cuenta_bancaria_id) {
      collectionData.cuenta_bancaria_id = resolveBankId(collectionData.cuenta_bancaria_id);
    }

    // Merge or overwrite payment details
    order.paymentDetails = {
      ...order.paymentDetails,
      ...collectionData
    };

    // Also update top-level paymentMethod string if coming from UI mapping
    if (collectionData.forma_cobro) {
      // Map code to label for display
      const methodMap: any = { 'TRA': 'Transferencia', 'EF': 'Efectivo', 'TC': 'Tarjeta de Crédito', 'CQ': 'Cheque' };
      order.paymentMethod = methodMap[collectionData.forma_cobro] || order.paymentMethod;
    }

    await order.save();

    // 3. Check Invoice Existence
    const documentId = order.invoiceInfo?.id;

    if (!documentId) {
      // Offline/Queued Mode
      // If invoice is not yet processed, we just save the payment info (done above)
      // and return success so the UI doesn't error out.

      // Ensure invoiceNeeded is true so batch picks it up
      if (!order.invoiceNeeded) {
        order.invoiceNeeded = true;
        order.invoiceStatus = "PENDING";
        await order.save();
      }

      res.status(HttpStatusCode.Ok).send({
        message: "Payment registered locally. Will be synced to Contífico when invoice is generated (Batch Process).",
        localOnly: true
      });
      return;
    }

    // 4. Register Collection in Contífico (Immediate Mode)
    // Ensure we send the fixed data
    const payloadToSend = {
      ...collectionData,
      cuenta_bancaria_id: resolveBankId(collectionData.cuenta_bancaria_id) // Redundant but safe
    };

    const result = await contificoService.registerCollection(documentId, payloadToSend);

    res.status(HttpStatusCode.Created).send({
      message: "Collection registered successfully in Contífico.",
      result
    });

  } catch (error: any) {
    console.error("❌ Error registering collection:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Failed to register collection.",
      error: error.message || String(error)
    });
  }
}


