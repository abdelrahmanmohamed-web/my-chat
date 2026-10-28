/** Owns the MongoDB connection lifecycle for the application. */

import mongoose from "mongoose";

import { env } from "../config/env.ts";

export async function connectMongoDB(): Promise<void> {
  await mongoose.connect(env.mongoUri);
}

export async function disconnectMongoDB(): Promise<void> {
  await mongoose.disconnect();
}
