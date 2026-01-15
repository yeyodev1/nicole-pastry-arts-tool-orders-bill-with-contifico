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

    // Default to today if no date params provided
    // Contífico uses DD/MM/YYYY
    if (!filters.fecha_emision && !filters.fecha_inicial && !filters.fecha_final) {
      const today = new Date().toLocaleDateString("en-GB");
      filters.fecha_emision = today;
      console.log("📅 No date filter provided. Defaulting to today:", today);
    }

    console.log("📥 Get Documents Request filters:", filters);

    const documents = await contificoService.getDocuments(filters);

    // Prepare arrays if response is null/undefined to avoid crash, though service handles 404
    const safeDocuments = Array.isArray(documents) ? documents : [];

    if (safeDocuments.length === 0) {
      res.status(HttpStatusCode.NotFound).send({
        message: "No documents found for the provided filters.",
        found: false,
        count: 0,
        filters: filters,
        data: []
      });
      return;
    }

    res.status(HttpStatusCode.Ok).send({
      message: "Documents retrieved successfully.",
      found: true,
      count: safeDocuments.length,
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
