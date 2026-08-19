import * as dotenv from "dotenv";
dotenv.config();
import createApp from "./app";
import dbConnect from "./config/mongo";
import { models } from "./models";
import { UserService } from "./services/user.service";
import { Branch } from "./models/branch.model";

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

async function main() {
  await dbConnect();

  // Seed default users
  const userService = new UserService();
  await userService.seedInitialUsers();

  // Seed default branches (only if none exist)
  await seedBranches();

  const { app, server } = createApp();

  server.timeout = 10 * 60 * 1000;

  const port: number | string = process.env.PORT || 8100;

  server.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });
}

main();
