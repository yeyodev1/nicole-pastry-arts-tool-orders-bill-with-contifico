import express, { Application } from "express";
import OrderRouter from "./order.router";
import ProductRouter from "./product.router";

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);
  router.use("/orders", OrderRouter);
  router.use("/products", ProductRouter);
}

export default routerApi;
