import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { OrderModel } from '../src/models/order.model';
dotenv.config();
const KEYWORDS = ['madre', 'dia de la madre', 'box dia'];
async function run() {
  await mongoose.connect(process.env.DB_URI || '');
  const orders = await OrderModel.find({ productionStage: { $ne: 'VOID' } }).lean();
  const hits: { name: string; orderDate: string; qty: number; price: number }[] = [];
  for (const o of orders) {
    for (const p of o.products) {
      if (KEYWORDS.some(k => p.name.toLowerCase().includes(k))) {
        hits.push({ name: p.name, orderDate: o.orderDate.toISOString().slice(0,10), qty: p.quantity, price: p.price });
      }
    }
  }
  if (!hits.length) { console.log('Sin resultados en toda la BD'); }
  else {
    console.log(`Encontrados ${hits.length} ítems:\n`);
    for (const h of hits) console.log(`  ${h.orderDate} | ${h.name} | qty:${h.qty} | $${h.price}`);
    const totalQty = hits.reduce((a,h) => a + h.qty, 0);
    const totalRev = hits.reduce((a,h) => a + h.qty * h.price, 0);
    console.log(`\nTOTAL: ${totalQty} unidades | $${totalRev.toFixed(2)}`);
  }
  await mongoose.disconnect(); process.exit(0);
}
run().catch(e => { console.error(e); process.exit(1); });
