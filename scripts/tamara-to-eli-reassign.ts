import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { UserModel } from '../src/models/user.model';
import { OrderModel } from '../src/models/order.model';

dotenv.config();

const DRY_RUN = true; // Set to false after user approval
const MIN_VALUE = 120;
const MAX_VALUE = 140;

async function run() {
  await mongoose.connect(process.env.DB_URI || '');
  console.log('✅ Connected to MongoDB\n');

  // 1. Find users
  const users = await UserModel.find({}).select('name email role contificoSource');
  console.log(`👥 Total users found: ${users.length}`);
  users.forEach(u => console.log(`   - ${u.name} | ${u.email} | ${u.role}`));
  console.log('');

  const eli = users.find(u => u.name.toLowerCase().includes('eli') && u.name.toLowerCase().includes('arellano'));
  const tamara = users.find(u => u.name.toLowerCase().includes('tamara'));

  if (!eli) { console.error('❌ Eli Arellano not found'); process.exit(1); }
  if (!tamara) { console.error('❌ Tamara not found'); process.exit(1); }

  console.log(`🎯 Eli Arellano  → name: "${eli.name}" | _id: ${eli._id}`);
  console.log(`🎯 Tamara        → name: "${tamara.name}" | _id: ${tamara._id}\n`);

  // 2. April 2026 orders by Tamara in range 120-140
  const startApril = new Date('2026-04-01T00:00:00.000Z');
  const endApril   = new Date('2026-04-30T23:59:59.999Z');

  const orders = await OrderModel.find({
    createdBy: tamara.name,
    orderDate: { $gte: startApril, $lte: endApril },
    totalValue: { $gte: MIN_VALUE, $lte: MAX_VALUE },
  }).select('_id customerName orderDate totalValue createdBy');

  console.log(`📦 Pedidos de Tamara (abril 2026, $${MIN_VALUE}–$${MAX_VALUE}): ${orders.length} encontrados\n`);

  if (orders.length === 0) {
    console.log('⚠️  No orders match the criteria.');
    process.exit(0);
  }

  orders.forEach((o, i) => {
    console.log(`   ${i + 1}. [${o._id}]`);
    console.log(`      Cliente:  ${o.customerName}`);
    console.log(`      Fecha:    ${o.orderDate.toISOString().split('T')[0]}`);
    console.log(`      Total:    $${o.totalValue}`);
    console.log(`      createdBy: ${o.createdBy}`);
  });

  const totalMoved = orders.reduce((sum, o) => sum + o.totalValue, 0);
  console.log(`\n💰 Total en pedidos a reasignar: $${totalMoved.toFixed(2)}`);

  if (DRY_RUN) {
    console.log('\n🔒 DRY RUN — ningún cambio fue aplicado.');
    console.log('   Para ejecutar: cambia DRY_RUN = false en el script y vuelve a correr.');
    process.exit(0);
  }

  // 3. Reassign createdBy → Eli Arellano
  const ids = orders.map(o => o._id);
  const result = await OrderModel.updateMany(
    { _id: { $in: ids } },
    {
      $set: { createdBy: eli.name, updatedBy: 'admin-script' },
      $push: {
        auditLog: {
          user: 'admin-script',
          action: `Reasignación: createdBy cambió de "${tamara.name}" → "${eli.name}"`,
          at: new Date(),
          details: `Script tamara-to-eli-reassign.ts | DRY_RUN=false`,
        }
      }
    }
  );

  console.log(`\n✅ ${result.modifiedCount} pedidos reasignados a "${eli.name}"`);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
