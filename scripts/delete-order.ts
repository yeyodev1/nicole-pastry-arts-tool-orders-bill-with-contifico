import mongoose from 'mongoose';
import * as dotenv from 'dotenv';
import { OrderModel } from '../src/models/order.model';

dotenv.config();

const ORDER_ID = '69d94d97ca7cab3eac13ed22';

async function run() {
  try {
    await mongoose.connect(process.env.DB_URI || '');
    console.log('Connected to MongoDB');

    const order = await OrderModel.findById(ORDER_ID);
    if (!order) {
      console.log(`❌ Order ${ORDER_ID} not found`);
      process.exit(1);
    }

    console.log(`Found order:`);
    console.log(`  Customer: ${order.customerName}`);
    console.log(`  Date: ${order.orderDate}`);
    console.log(`  Products: ${order.products.length}`);
    console.log(`  Status: ${order.productionStage}`);

    await OrderModel.findByIdAndDelete(ORDER_ID);
    console.log(`✅ Order ${ORDER_ID} deleted successfully`);

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

run();
