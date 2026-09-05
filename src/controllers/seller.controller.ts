import type { Response, NextFunction } from "express";
import { SellerModel } from "../models/seller.model";
import { AuthRequest } from "../types/AuthRequest";

/** Sólo dígitos: Contífico identifica al vendedor por su cédula. */
function normalizeIdentification(raw: unknown): string {
  return String(raw ?? "").replace(/\D/g, "");
}

/**
 * GET /api/sellers
 * Catálogo de vendedores asignables a un pedido. `?all=true` incluye inactivos.
 */
export async function getSellers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const includeInactive = req.query.all === "true";
    const filter = includeInactive ? {} : { isActive: true };

    const sellers = await SellerModel.find(filter).sort({ sortOrder: 1, name: 1 });

    res.status(200).send({
      message: "Sellers retrieved successfully.",
      data: sellers,
    });
  } catch (error) {
    next(error);
  }
}

/** POST /api/sellers */
export async function createSeller(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, contificoPersonId, contificoSource, isActive, sortOrder } = req.body;
    const identification = normalizeIdentification(req.body?.identification);

    if (!name || typeof name !== "string" || !name.trim()) {
      res.status(400).send({ message: "Seller name is required." });
      return;
    }
    if (!identification) {
      res.status(400).send({ message: "Seller identification (cédula) is required." });
      return;
    }

    const source = contificoSource === "sucree" ? "sucree" : "nicole";
    const existing = await SellerModel.findOne({ contificoSource: source, identification });
    if (existing) {
      res.status(409).send({ message: "A seller with this identification already exists." });
      return;
    }

    const seller = await SellerModel.create({
      name: name.trim(),
      identification,
      contificoPersonId: contificoPersonId?.trim() || undefined,
      contificoSource: source,
      isActive: isActive !== false,
      sortOrder: sortOrder ?? 0,
    });

    res.status(201).send({ message: "Seller created successfully.", data: seller });
  } catch (error) {
    next(error);
  }
}

/** PUT /api/sellers/:id */
export async function updateSeller(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const { name, contificoPersonId, isActive, sortOrder } = req.body;

    const seller = await SellerModel.findById(id);
    if (!seller) {
      res.status(404).send({ message: "Seller not found." });
      return;
    }

    if (name !== undefined) {
      if (!String(name).trim()) {
        res.status(400).send({ message: "Seller name cannot be empty." });
        return;
      }
      seller.name = String(name).trim();
    }

    if (req.body.identification !== undefined) {
      const identification = normalizeIdentification(req.body.identification);
      if (!identification) {
        res.status(400).send({ message: "Seller identification cannot be empty." });
        return;
      }
      const duplicate = await SellerModel.findOne({
        contificoSource: seller.contificoSource,
        identification,
        _id: { $ne: id },
      });
      if (duplicate) {
        res.status(409).send({ message: "A seller with this identification already exists." });
        return;
      }
      // Cambiar la cédula invalida el ID cacheado: apunta a otra persona en Contífico.
      if (identification !== seller.identification) {
        seller.identification = identification;
        seller.contificoPersonId = undefined;
      }
    }

    if (contificoPersonId !== undefined) seller.contificoPersonId = contificoPersonId?.trim() || undefined;
    if (isActive !== undefined) seller.isActive = isActive;
    if (sortOrder !== undefined) seller.sortOrder = sortOrder;

    await seller.save();

    res.status(200).send({ message: "Seller updated successfully.", data: seller });
  } catch (error) {
    next(error);
  }
}

/** DELETE /api/sellers/:id — desactiva, no borra: las facturas ya emitidas lo referencian. */
export async function deactivateSeller(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const seller = await SellerModel.findByIdAndUpdate(id, { isActive: false }, { new: true });
    if (!seller) {
      res.status(404).send({ message: "Seller not found." });
      return;
    }
    res.status(200).send({ message: "Seller deactivated successfully.", data: seller });
  } catch (error) {
    next(error);
  }
}
