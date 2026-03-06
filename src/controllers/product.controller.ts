import type { Request, Response, NextFunction } from "express";
import { ContificoService } from "../services/contifico.service";
import { HttpStatusCode } from "axios";

const contificoService = new ContificoService();

export async function getProducts(req: Request, res: Response, next: NextFunction) {
  try {
    const { query, filtro, codigo_barra, categoria_id, page, limit } = req.query;

    const searchOptions = {
      filtro: (filtro as string) || (query as string),
      codigo_barra: codigo_barra as string,
      categoria_id: categoria_id as string,
      result_page: page ? Number(page) : undefined,
      result_size: limit ? Number(limit) : 20 // Default to 20
    };

    const products = await contificoService.getProducts(searchOptions);

    res.status(200).send(products);
    return;
  } catch (error: any) {
    console.error("❌ Error in getProducts:", error);
    const isContificoDown = error?.message?.includes("Contífico") || error?.contificoStatus;
    if (isContificoDown) {
      res.status(503).send({
        message: "Contífico no está disponible en este momento. Intenta de nuevo en unos minutos.",
        error: "contifico_unavailable",
        contificoStatus: error?.contificoStatus ?? null
      });
      return;
    }
    res.status(500).send({
      message: "Internal server error occurred while fetching products.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}


export async function getCategories(req: Request, res: Response, next: NextFunction) {
  try {
    const categories = await contificoService.getCategories();
    res.status(HttpStatusCode.Ok).send(categories);
    return;
  } catch (error) {
    console.error("❌ Error in getCategories:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Internal server error occurred while fetching categories.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
} 