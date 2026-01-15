import type { Request, Response, NextFunction } from "express";
import { HttpStatusCode } from "axios";
import { ContificoService } from "../services/contifico.service";
import { IPerson } from "../interfaces/person.interface";

const contificoService = new ContificoService();

export async function getPerson(req: Request, res: Response, next: NextFunction) {
  try {
    const { identificacion, search } = req.query;
    const query = (identificacion as string) || (search as string);

    if (!query) {
      res.status(HttpStatusCode.BadRequest).send({ message: "Search parameter (identificacion or search) is required" });
      return;
    }

    const persons = await contificoService.getPerson(query);

    // If result is empty array or null, return 404
    if (!persons || (Array.isArray(persons) && persons.length === 0)) {
      res.status(HttpStatusCode.NotFound).send({
        message: "Person not found with the provided identification or name.",
        found: false
      });
      return;
    }

    res.status(HttpStatusCode.Ok).send({
      message: "Persons retrieval successfully.",
      data: persons
    });
    return;
  } catch (error) {
    console.error("❌ Error in getPerson:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Internal server error occurred while fetching person.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}

export async function createPerson(req: Request, res: Response, next: NextFunction) {
  try {
    const personData: IPerson = req.body;

    // Minimum structure required for Invoice (Factura)
    if (!personData.ruc || !personData.razon_social || !personData.email || !personData.direccion || !personData.telefonos) {
      res.status(HttpStatusCode.BadRequest).send({
        message: "Missing required fields for Invoice. Required: ruc, razon_social, email, direccion, telefonos."
      });
      return;
    }

    const newPerson = await contificoService.createPerson(personData);

    res.status(HttpStatusCode.Created).send({
      message: "Person created successfully",
      person: newPerson
    });
    return;
  } catch (error) {
    console.error("❌ Error in createPerson:", error);
    res.status(HttpStatusCode.InternalServerError).send({
      message: "Internal server error occurred while creating person.",
      error: error instanceof Error ? error.message : String(error)
    });
    return;
  }
}
