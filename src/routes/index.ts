import express, { Application } from "express";

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);
}

export default routerApi;
