import type { Request, Response, NextFunction } from "express";
import { HttpStatusCode } from "axios";
import { ContificoService } from "../services/contifico.service";

const contificoService = new ContificoService();

/**
 * Get list of documents (movements)
 * Supports query params: fecha_emision, tipo, persona_identificacion, etc.
 */
export async function getDocuments(req: Request, res: Response, next: NextFunction) {
  try {
    const filters = req.query;

    // Default to Last 30 Days if no date params provided
    // This provides immediate Dashboard value
    if (!filters.fecha_emision && !filters.fecha_inicial && !filters.fecha_final) {
      const today = new Date();
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(today.getDate() - 30);

      const formatDate = (date: Date) => date.toLocaleDateString("en-GB"); // DD/MM/YYYY

      filters.fecha_inicial = formatDate(thirtyDaysAgo);
      filters.fecha_final = formatDate(today);

      console.log(`📅 No date filter. Defaulting to Dashboard Mode (${filters.fecha_inicial} - ${filters.fecha_final})`);
    }

    console.log("📥 Get Documents Request filters:", filters);

    const documents = await contificoService.getDocuments(filters);

    // Prepare arrays if response is null/undefined to avoid crash
    const safeDocuments = Array.isArray(documents) ? documents : [];

    // Calculate Dashboard Stats
    const stats = safeDocuments.reduce((acc: any, doc: any) => {
      const total = parseFloat(doc.total || "0");
      acc.totalSales += total;
      acc.count++;
      return acc;
    }, { totalSales: 0, count: 0 });

    // Round total to 2 decimals
    stats.totalSales = Math.round(stats.totalSales * 100) / 100;

    if (safeDocuments.length === 0) {
      res.status(HttpStatusCode.NotFound).send({
        message: "No documents found for the provided filters.",
        found: false,
        count: 0,
        stats: { totalSales: 0, count: 0 },
        filters: filters,
        data: []
      });
      return;
    }

    res.status(HttpStatusCode.Ok).send({
      message: "Documents retrieved successfully.",
      found: true,
      count: safeDocuments.length,
      stats: stats,
      filters: filters,
      data: safeDocuments
    });
    return;
  } catch (error) {
    console.error("❌ Error in getDocuments:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Internal server error while fetching documents.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}
