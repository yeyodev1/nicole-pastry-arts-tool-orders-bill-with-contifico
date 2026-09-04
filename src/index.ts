import * as dotenv from "dotenv";
dotenv.config();
import createApp from "./app";
import dbConnect from "./config/mongo";
import { models } from "./models";
import { UserService } from "./services/user.service";
import { Branch } from "./models/branch.model";
import { SellerModel } from "./models/seller.model";

const DEFAULT_BRANCHES = [
  { name: "San Marino",          sortOrder: 1 },
  { name: "Mall del Sol",        sortOrder: 2 },
  { name: "Entre Ríos",          sortOrder: 3 },
  { name: "Centro de Producción", sortOrder: 4 },
];

async function seedBranches() {
  for (const branch of DEFAULT_BRANCHES) {
    await Branch.updateOne(
      { name: branch.name },
      { $setOnInsert: { name: branch.name, isActive: true, sortOrder: branch.sortOrder } },
      { upsert: true }
    );
  }
  console.log("Default branches ensured.");
}

/**
 * Vendedores que pueden salir en la factura de Contífico (base de comisiones).
 * Los IDs y cédulas están verificados contra la API de Contífico — las cuatro
 * personas ya existen ahí con `es_vendedor: true`.
 */
const DEFAULT_SELLERS = [
  { name: "NOHELIA ARMAS BUSTOS",            identification: "0953691706", contificoPersonId: "BXdL8RlNmC231dJZ", sortOrder: 1 },
  { name: "FIALHO VARGAS FLAVIO FERNANDO",   identification: "0926710666", contificoPersonId: "y7aAPx7yoF5RWegZ", sortOrder: 2 },
  { name: "DOMENICA SOLANGE AVILES ROBIN",   identification: "0955801303", contificoPersonId: "jZdyrArWAc34MeJ4", sortOrder: 3 },
  { name: "REBECCA MARCELA PINTO PIVAQUE",   identification: "0950639427", contificoPersonId: "XKdwjgAjoFnN1bgW", sortOrder: 4 },
];

async function seedSellers() {
  for (const seller of DEFAULT_SELLERS) {
    await SellerModel.updateOne(
      { contificoSource: "nicole", identification: seller.identification },
      {
        // El nombre y el ID de Contífico se refrescan siempre para que un cambio
        // en el ERP no deje al catálogo apuntando a una persona equivocada.
        $set: {
          name: seller.name,
          contificoPersonId: seller.contificoPersonId,
          sortOrder: seller.sortOrder,
        },
        $setOnInsert: { contificoSource: "nicole", identification: seller.identification, isActive: true },
      },
      { upsert: true }
    );
  }
  console.log("Default sellers ensured.");
}

async function main() {
  await dbConnect();

  // Seed default users
  const userService = new UserService();
  await userService.seedInitialUsers();

  // Seed default branches (only if none exist)
  await seedBranches();

  // Seed default sellers (comisiones en la factura)
  await seedSellers();

  const { app, server } = createApp();

  server.timeout = 10 * 60 * 1000;

  const port: number | string = process.env.PORT || 8100;

  server.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

main();
