import type { Request, Response, NextFunction } from "express";
import { ContificoService } from "../services/contifico.service";

const contificoService = new ContificoService();

export async function getProducts(req: Request, res: Response, next: NextFunction) {
  try {
    const { query, filtro, codigo_barra, categoria_id } = req.query;

    const searchOptions = {
      filtro: (filtro as string) || (query as string),
      codigo_barra: codigo_barra as string,
      categoria_id: categoria_id as string
    };

    const products = await contificoService.getProducts(searchOptions);

    res.status(200).send(products);
    return;
  } catch (error) {
    console.error("❌ Error in getProducts:", error);
    res.status(500).send({
      message: "Internal server error occurred while fetching products.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}
