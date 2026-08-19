import type { Response, NextFunction } from "express";
import { ContificoService } from "../services/contifico.service";
import { HttpStatusCode } from "axios";
import { AuthRequest } from "../types/AuthRequest";
import { UserService } from "../services/user.service";

// Una instancia por cuenta de Contífico — cada una tiene su propio caché
const nicoleService = new ContificoService('nicole');
const sucreeService = new ContificoService('sucree');
const userService = new UserService();

export async function getProducts(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { query, filtro, codigo_barra, categoria_id, page, limit } = req.query;

    const searchOptions = {
      filtro: (filtro as string) || (query as string),
      codigo_barra: codigo_barra as string,
      categoria_id: categoria_id as string,
      result_page: page ? Number(page) : undefined,
      result_size: limit ? Number(limit) : 20 // Default 20 por página
    };

    // Leer contificoSource SIEMPRE desde la BD (no desde el JWT) para reflejar
    // cambios de perfil sin necesidad de que el usuario cierre sesión y vuelva a entrar.
    let userSource: string = 'nicole';
    if (req.user?.email) {
      const freshUser = await userService.findByEmail(req.user.email);
      userSource = (freshUser as any)?.contificoSource || 'nicole';
    }

    let allProducts: any[] = [];
    const errors: string[] = [];

    // --- Fetch Nicole ---
    if (userSource === 'nicole' || userSource === 'both') {
      try {
        const nicoleProducts = await nicoleService.getProducts(searchOptions);
        const tagged = (nicoleProducts || []).map((p: any) => ({
          ...p,
          source: 'nicole' // Etiqueta para identificar el negocio en el frontend
        }));
        allProducts.push(...tagged);
      } catch (err: any) {
        console.error("❌ Error fetching Nicole products:", err.message);
        errors.push('nicole');
      }
    }

    // --- Fetch Sucree ---
    if (userSource === 'sucree' || userSource === 'both') {
      try {
        const sucreeProducts = await sucreeService.getProducts(searchOptions);
        const tagged = (sucreeProducts || []).map((p: any) => ({
          ...p,
          source: 'sucree' // Etiqueta para identificar el negocio en el frontend
        }));
        allProducts.push(...tagged);
      } catch (err: any) {
        console.error("❌ Error fetching Sucree products:", err.message);
        errors.push('sucree');
      }
    }

    // Si TODAS las fuentes fallaron, retornar 503
    const sourcesExpected = userSource === 'both' ? 2 : 1;
    if (errors.length === sourcesExpected) {
      res.status(503).send({
        message: "Contífico no está disponible en este momento. Intenta de nuevo en unos minutos.",
        error: "contifico_unavailable",
      });
      return;
    }

    res.status(200).send(allProducts);
    return;
  } catch (error: any) {
    console.error("❌ Error in getProducts:", error);
    res.status(500).send({
      message: "Internal server error occurred while fetching products.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}


export async function getCategories(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    // Para categorías, usar Nicole por defecto (usada en catálogos internos)
    const categories = await nicoleService.getCategories();
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
