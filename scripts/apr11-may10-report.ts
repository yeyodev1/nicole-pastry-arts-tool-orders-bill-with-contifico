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
  }).lean();

  const out: any = { totalOrders: orders.length };

  const billing: Record<string, number> = { nicole: 0, sucree: 0 };
  const countBySource: Record<string, number> = { nicole: 0, sucree: 0 };
  for (const o of orders as any[]) {
    const src = (o.contificoSource as string) || 'nicole';
    const discount = o.globalDiscountPercentage ?? 0;
    const val = o.isGlobalCourtesy ? 0 : (o.totalValue || 0) * (1 - discount / 100);
    billing[src] = (billing[src] ?? 0) + val;
    countBySource[src] = (countBySource[src] ?? 0) + 1;
  }
  out.billing = billing;
  out.countBySource = countBySource;

  const sourceCount: Record<string, number> = {};
  const sourceRevenue: Record<string, number> = {};
  for (const o of orders as any[]) {
    if ((o.contificoSource || 'nicole') !== 'nicole') continue;
    const s = o.orderSource || (o as any).source || 'sin_origen';
    const discount = o.globalDiscountPercentage ?? 0;
    const val = o.isGlobalCourtesy ? 0 : (o.totalValue || 0) * (1 - discount / 100);
    sourceCount[s] = (sourceCount[s] || 0) + 1;
    sourceRevenue[s] = (sourceRevenue[s] || 0) + val;
  }
  out.byOrderSourceNicole = { count: sourceCount, revenue: sourceRevenue };

  const daily: Record<string, {count:number, rev:number}> = {};
  for (const o of orders as any[]) {
    if ((o.contificoSource || 'nicole') !== 'nicole') continue;
    const d = new Date(o.orderDate).toISOString().slice(0,10);
    const discount = o.globalDiscountPercentage ?? 0;
    const val = o.isGlobalCourtesy ? 0 : (o.totalValue || 0) * (1 - discount / 100);
    if (!daily[d]) daily[d] = {count:0, rev:0};
    daily[d].count++;
    daily[d].rev += val;
  }
  out.dailyNicole = daily;

  const nicoleOrders = (orders as any[]).filter(o => (o.contificoSource || 'nicole') === 'nicole' && !o.isGlobalCourtesy);
  out.nicoleAOV = nicoleOrders.length ? billing.nicole / nicoleOrders.length : 0;
  out.nicoleNonCourtesyCount = nicoleOrders.length;

  console.log(JSON.stringify(out, null, 2));
  await mongoose.disconnect();
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
