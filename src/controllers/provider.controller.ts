import type { Request, Response, NextFunction } from "express";
import { HttpStatusCode } from "axios";
import { models } from "../models";

export async function getProviders(req: Request, res: Response, next: NextFunction) {
  try {
    let query: any = {};
    const { search } = req.query;

    if (search) {
      const searchRegex = new RegExp(String(search), 'i');
      query = {
        $or: [
          { name: searchRegex },
          { ruc: searchRegex },
          { email: searchRegex },
          { phone: searchRegex }
        ]
      };
    }

    const providers = await models.providers.find(query).sort({ name: 1 }).lean();

    // Get item counts for all providers
    const providersWithExtras = await Promise.all(providers.map(async (provider) => {
      const itemCount = await models.rawMaterials.countDocuments({ provider: provider._id });
      return {
        ...provider,
        itemCount
      };
    }));

    res.status(HttpStatusCode.Ok).send({
      message: "Providers retrieved successfully.",
      data: providersWithExtras
    });
    return;
  } catch (error) {
    console.error("❌ Error in getProviders:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Error fetching providers.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

export async function createProvider(req: Request, res: Response, next: NextFunction) {
  try {
    const providerData = req.body;

    if (!providerData.name) {
      res.status(HttpStatusCode.BadRequest).send({
        message: "Provider name is required."
      });
      return;
    }

    const missingFields = [];
    if (!providerData.ruc?.trim()) missingFields.push("RUC");
    if (!providerData.phone?.trim()) missingFields.push("Teléfono");
    if (!providerData.address?.trim()) missingFields.push("Dirección");
    if (!providerData.email?.trim()) missingFields.push("Correo electrónico");

    if (missingFields.length > 0) {
      res.status(HttpStatusCode.BadRequest).send({
        message: `Debe completar todos los campos obligatorios antes de crear el proveedor: ${missingFields.join(", ")}.`
      });
      return;
    }

    const existing = await models.providers.findOne({ name: providerData.name });
    if (existing) {
      res.status(HttpStatusCode.Conflict).send({
        message: "A provider with this name already exists."
      });
      return;
    }

    const newProvider = new models.providers(providerData);
    await newProvider.save();

    res.status(HttpStatusCode.Created).send({
      message: "Provider created successfully.",
      data: newProvider
    });
    return;
  } catch (error) {
    console.error("❌ Error in createProvider:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Error creating provider.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

export async function updateProvider(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;
    const updateData = req.body;

    const provider = await models.providers.findByIdAndUpdate(id, updateData, { new: true });
    if (!provider) {
      res.status(HttpStatusCode.NotFound).send({ message: "Provider not found." });
      return;
    }

    res.status(HttpStatusCode.Ok).send({
      message: "Provider updated successfully.",
      data: provider
    });
    return;
  } catch (error) {
    console.error("❌ Error in updateProvider:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Error updating provider.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

export async function deleteProvider(req: Request, res: Response, next: NextFunction) {
  try {
    const { id } = req.params;

    const provider = await models.providers.findByIdAndDelete(id);
    if (!provider) {
      res.status(HttpStatusCode.NotFound).send({ message: "Provider not found." });
      return;
    }

    res.status(HttpStatusCode.Ok).send({
      message: "Provider deleted successfully."
    });
    return;
  } catch (error) {
    console.error("❌ Error in deleteProvider:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Error deleting provider.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}
