import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { OrderModel } from '../src/models/order.model';

dotenv.config();

const START = new Date('2026-04-10T00:00:00.000-05:00');
const END   = new Date('2026-05-11T23:59:59.999-05:00');

async function run() {
  await mongoose.connect(process.env.DB_URI || '');

  const orders = await OrderModel.find({
    orderDate: { $gte: START, $lte: END },
    productionStage: { $ne: 'VOID' },
    contificoSource: 'nicole',
  }).lean();

  const stats: Record<string, {count:number, rev:number}> = {};
  for (const o of orders as any[]) {
    const resp = o.responsible || 'Sin asignar';
    const discount = o.globalDiscountPercentage ?? 0;
    const val = o.isGlobalCourtesy ? 0 : (o.totalValue || 0) * (1 - discount / 100);
    if (!stats[resp]) stats[resp] = {count:0, rev:0};
    stats[resp].count++;
    stats[resp].rev += val;
  }

  console.log('=== VENDEDORES Apr10-May11 Nicole ===');
  for (const [name, s] of Object.entries(stats).sort((a,b)=>b[1].rev - a[1].rev)) {
    console.log(`${name}: ${s.count} pedidos | $${s.rev.toFixed(2)}`);
  }
  console.log('TOTAL ORDERS:', orders.length);
  console.log('TOTAL REV: $', Object.values(stats).reduce((a,b)=>a+b.rev,0).toFixed(2));

  await mongoose.disconnect();
  process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
