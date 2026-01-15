import type { Request, Response, NextFunction } from "express";
import { models } from "../models";
import { ContificoService } from "../services/contifico.service";

const contificoService = new ContificoService();

export async function createOrder(req: Request, res: Response, next: NextFunction) {
  try {
    const orderData = req.body;

    // 1. Basic Validation (Simplified for testing)
    if (!orderData.customerName || !orderData.products || orderData.products.length === 0) {
      res.status(400).send({
        message: "Customer name and products are required.",
      });
      return;
    }

    // 2. Save Order to Database
    const newOrder = new models.orders(orderData);
    await newOrder.save();

    // 3. Handle Invoicing via Contífico if requested
    // DEFERRED LOGIC: We no longer create invoice immediately.
    // It is marked as 'PENDING' by default in the model if invoiceNeeded is true.

    // 4. Generate WhatsApp Message
    const productsString = orderData.products
      .map((p: any) => `- ${p.quantity}x ${p.name}`)
      .join("\n");

    const whatsappMessage = `
Confirmado su pedido
Nombre: ${orderData.customerName}
Dirección factura: ${orderData.invoiceData?.address || "N/A"}
Retiro/Entrega: ${orderData.deliveryType}
Pedido: 
${productsString}
Fecha y Hora: ${new Date(orderData.deliveryDate).toLocaleString()}
Celular: ${orderData.customerPhone}
Cédula o RUC: ${orderData.invoiceData?.ruc || "N/A"}
Correo: ${orderData.invoiceData?.email || "N/A"}
Ubicación: ${orderData.deliveryType === "delivery" ? "See comments for address" : "Retiro en local"}
    `.trim();

    // 5. Send Response
    res.status(201).send({
      message: "Order created successfully. Invoice will be generated at the end of the day.",
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
 * Process all pending invoices for the day
 * This should be called by a CRON job at 11:59 PM
 */
export async function processPendingInvoices(req: Request, res: Response, next: NextFunction) {
  try {
    console.log("⏰ Starting batch invoice processing...");

    // Find all orders with invoiceNeeded: true AND invoiceStatus: 'PENDING'
    const pendingOrders = await models.orders.find({
      invoiceNeeded: true,
      invoiceStatus: "PENDING"
    });

    if (pendingOrders.length === 0) {
      console.log("✅ No pending invoices to process.");
      res.status(200).send({ message: "No pending invoices found." });
      return;
    }

    console.log(`📦 Found ${pendingOrders.length} pending invoices.`);

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
          throw new Error(invoiceResponse.error);
        }

        order.invoiceStatus = "PROCESSED";
        order.invoiceInfo = invoiceResponse; // Save the invoice details
        await order.save();

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

    res.status(200).send({
      message: "Batch processing completed.",
      results
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
