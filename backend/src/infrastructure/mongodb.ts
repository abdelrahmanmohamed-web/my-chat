/** Owns the MongoDB connection lifecycle for the application. */

import mongoose from "mongoose";

import { env } from "../config/env.ts";
import { User } from "../modules/users/user.model.ts";
import { Session } from "../modules/auth/sessions/session.model.ts";

export async function connectMongoDB(): Promise<void> {
  await mongoose.connect(env.mongoUri, {
    dbName: "online_chat",
  });
  await Promise.all([User.createIndexes(), Session.createIndexes()]);
}

export async function disconnectMongoDB(): Promise<void> {
  await mongoose.disconnect();
}
