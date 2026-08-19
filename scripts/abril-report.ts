import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { OrderModel } from '../src/models/order.model';

dotenv.config();

const START = new Date('2026-04-01T00:00:00.000-05:00');
const END   = new Date('2026-04-30T23:59:59.999-05:00');

const TARGET_PRODUCTS = [
  'black mom',
  'black & white mom',
  'white mom',
  'torta latte salted',
  'torta salted caramel',
  'pack de fruta',
  'box dia de la madre',
];

async function run() {
  await mongoose.connect(process.env.DB_URI || '');
  console.log('Conectado a MongoDB\n');

  const orders = await OrderModel.find({
    orderDate: { $gte: START, $lte: END },
    productionStage: { $ne: 'VOID' },
  }).lean();

  console.log(`Total órdenes abril (no VOID): ${orders.length}\n`);

  // ── Facturación por fuente ──────────────────────────────────────────────
  const billing: Record<string, number> = { nicole: 0, sucree: 0 };
  for (const o of orders) {
    const src = (o.contificoSource as string) || 'nicole';
    const discount = o.globalDiscountPercentage ?? 0;
    const val = o.isGlobalCourtesy ? 0 : o.totalValue * (1 - discount / 100);
    billing[src] = (billing[src] ?? 0) + val;
  }

  console.log('═══════════════════════════════════════');
  console.log('  FACTURACIÓN ABRIL 2026');
  console.log('═══════════════════════════════════════');
  console.log(`  Nicole  : $${billing['nicole'].toFixed(2)}`);
  console.log(`  Sucree  : $${billing['sucree'].toFixed(2)}`);
  console.log(`  TOTAL   : $${(billing['nicole'] + billing['sucree']).toFixed(2)}`);
  console.log('');

  // ── Productos objetivo ──────────────────────────────────────────────────
  const stats: Record<string, { qty: number; revenue: number }> = {};
  for (const key of TARGET_PRODUCTS) stats[key] = { qty: 0, revenue: 0 };

  for (const o of orders) {
    if (o.isGlobalCourtesy) continue;
    for (const p of o.products) {
      const nameLower = p.name.toLowerCase().trim();
      for (const target of TARGET_PRODUCTS) {
        if (nameLower.includes(target)) {
          const qty = p.quantity ?? 1;
          const rev = p.isCourtesy ? 0 : (p.price ?? 0) * qty;
          stats[target].qty += qty;
          stats[target].revenue += rev;
        }
      }
    }
  }

  console.log('═══════════════════════════════════════');
  console.log('  PRODUCTOS OBJETIVO — ABRIL 2026');
  console.log('═══════════════════════════════════════');
  for (const [name, s] of Object.entries(stats)) {
    console.log(`  ${name}`);
    console.log(`    Unidades : ${s.qty}`);
    console.log(`    Revenue  : $${s.revenue.toFixed(2)}`);
  }
  console.log('');

  await mongoose.disconnect();
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
