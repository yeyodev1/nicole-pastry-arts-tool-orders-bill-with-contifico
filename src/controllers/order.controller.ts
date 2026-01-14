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
    let invoiceInfo = null;
    if (orderData.invoiceNeeded && orderData.invoiceData) {
      try {
        invoiceInfo = await contificoService.createInvoice(orderData);
      } catch (invoiceError: any) {
        console.warn("⚠️ Invoice creation failed, but order was saved:", invoiceError.message);
        // We don't fail the whole request because the order is already saved
      }
    }

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
      message: "Order created successfully.",
      order: newOrder,
      invoiceInfo,
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
