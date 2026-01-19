import express from "express";
import type { Response } from "express";

import http from "http";
import cors from "cors";
import routerApi from "./routes";
import { globalErrorHandler } from "./middlewares/globalErrorHandler.middleware";

export default function createApp() {
  const app = express();

  const server = http.createServer(app);

  const whitelist = [
    "http://localhost:8100",
    "http://localhost:8101",
    "http://localhost:8080",
    "http://localhost:5173",
    "https://nicole-sells-bills.netlify.app"
  ];

  const corsOptions = {
    origin: function (origin: any, callback: any) {
      const normalizedOrigin = origin?.replace(/\/$/, "");
      console.log("🟡 Origin recibido:", origin);

      if (!origin || whitelist.includes(normalizedOrigin)) {
        callback(null, true);
      } else {
        console.log(`❌ CORS bloqueado para: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  };

  app.use(cors(corsOptions));

  app.use((req, res, next) => {
    console.log(`🌐 Petición desde: ${req.headers.origin}`);
    next();
  });

  app.use(express.json({ limit: "50mb" }));

  app.get("/", (_req, res: Response) => {
    res.send("factura y ordenes de nicole backend IS ALIVEEEEEEE:)");
  });

  routerApi(app);

  app.use(globalErrorHandler);

  return { app, server };
}
