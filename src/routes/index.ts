import express, { Application } from "express";
import OrderRouter from "./order.router";
import ProductRouter from "./product.router";
import PersonRouter from "./person.router";
import DocumentRouter from "./document.router";

function routerApi(app: Application) {
  const router = express.Router();
  app.use("/api", router);
  router.use("/orders", OrderRouter);
  router.use("/products", ProductRouter);
  router.use("/persons", PersonRouter);
  router.use("/documents", DocumentRouter);
}

export default routerApi;
