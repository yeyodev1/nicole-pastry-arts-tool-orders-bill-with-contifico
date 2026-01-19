import mongoose from "mongoose";

async function dbConnect(): Promise<void> {
  try {
    let DB_URI = process.env.DB_URI;

    if (!DB_URI) {
      throw new Error("No mongo DB_URI");
    }

    await mongoose.connect(DB_URI);
    console.log("*** SUCCESSFULLY CONNECTED TO DATABASE FUDMASTER FRIENDDD  ***");
  } catch (error) {
    console.log("*** CONECTION FAILED ***", error);
    throw error; // Fail fast: do not let the app start without DB
  }
}

export default dbConnect;
