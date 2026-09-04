# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Dev server:** `pnpm dev` (ts-node-dev with auto-restart, default port 8100)
- **Build:** `pnpm build` (tsc → `dist/`)
- **Start prod:** `pnpm start` (runs `node dist/index.js`)
- **Watch compile:** `pnpm compile` (tsc --watch)
- **Format:** `pnpm format` (Prettier)
- **Seed users:** `pnpm seed:users`
- **No test runner is configured.**

## Tech Stack

- Express 5 + TypeScript (CommonJS, target ES2024)
- MongoDB via Mongoose (connection string from `DB_URI` env var)
- JWT authentication (Bearer tokens, 2h expiry)
- Cloudinary for file uploads, Multer for multipart handling
- Contífico API integration (external accounting/ERP system)
- Google Generative AI (`@google/genai`) and OpenAI SDKs
- Resend for email delivery
- PDFKit for PDF generation
- Deployed on Vercel (`vercel.json` routes all traffic to `dist/index.js`)

## Architecture

### Request Flow

All routes are mounted under `/api` prefix. The flow is:
`Express app → CORS → JSON parser (50mb limit) → /api router → route-specific handlers → globalErrorHandler`

### API Routes (`/api/...`)

| Prefix | Router |
|---|---|
| `/orders` | Order CRUD and management |
| `/products` | Product catalog (Contífico integration) |
| `/persons` | Person/client records |
| `/documents` | Document generation |
| `/analytics` | Sales/reporting analytics |
| `/users` | Auth (login) and user management |
| `/production` | Production workflow |
| `/pos` | Point of sale operations |
| `/replenishment` | Inventory replenishment |
| `/delivery-personnel` | Delivery person management |
| `/providers` | Supplier management |
| `/raw-materials` | Raw material inventory |
| `/provider-categories` | Supplier categorization |
| `/warehouse` | Warehouse/stock movements |
| `/sellers` | Vendedores asignables a la factura (comisiones) |

### Layered Structure

- **Routes** (`src/routes/`) — Define endpoints, apply `authMiddleware`, delegate to controllers
- **Controllers** (`src/controllers/`) — Handle req/res, call services
- **Services** (`src/services/`) — Business logic and external API calls
- **Models** (`src/models/`) — Mongoose schemas/models

### Key Patterns

- **Auth middleware** (`src/middlewares/auth.middleware.ts`) — Verifies JWT Bearer token, attaches decoded payload to `req.user` (typed as `AuthRequest`)
- **Custom errors** — Throw `CustomError` (from `src/errors/customError.error.ts`) with status code; caught by `globalErrorHandler`
- **Contífico service** (`src/services/contifico.service.ts`) — External ERP integration with in-memory cache (1h TTL for products/categories). Credentials: `CONTIFICO_API_KEY`, `CONTIFICO_TOKEN`
- **Numeración de facturas** — El número sale de `nextInvoiceNumber()`: serie fija (001-001 = CDP) + contador atómico en Mongo (`InvoiceSequence`), sembrado con el último secuencial real de Contífico. Sembrar con `pnpm seed:invoice-sequence` antes de desplegar cambios de serie.
- **Vendedor en la factura** — `resolveVendedorPayload()` mapea el pedido a una persona `es_vendedor` de Contífico (catálogo `Seller`, expuesto en `/api/sellers`) y lo envía como `vendedor_id`. Es la base del reporte de comisiones.
- **File uploads** — Multer middleware saves to `uploads/` dir with unique filenames (100MB limit, max 10 files)
- **Startup** — `index.ts` connects to MongoDB, seeds default users, then starts the HTTP server (10min timeout)

### Environment Variables

Required: `DB_URI`, `JWT_SECRET`, `CONTIFICO_API_KEY`, `CONTIFICO_TOKEN`. Check `.env` for additional keys (Cloudinary, Resend, Google AI, OpenAI, Firebase).

Optional, punto de emisión de facturas (`src/config/contifico-emision.config.ts`):
`CONTIFICO_ESTABLECIMIENTO` (default `001`), `CONTIFICO_PUNTO_EMISION` (default `001` = Matriz / CDP),
`CONTIFICO_SECUENCIAL_MINIMO` (piso del contador si Contífico no devuelve documentos de la serie).

### Models (Mongoose)

`Order`, `DailySummary`, `User`, `ParLevel`, `DeliveryPerson`, `Provider`, `RawMaterial`, `ProviderCategory`, `WarehouseMovement`, `Seller`, `InvoiceSequence` — all exported from `src/models/index.ts`.

### Scripts

Utility scripts in `scripts/` for database seeding and Contífico API exploration (run with `ts-node-dev`).
