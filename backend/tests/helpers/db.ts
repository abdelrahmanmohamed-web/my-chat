import mongoose from "mongoose";
import { User } from "../../src/modules/users/user.model.ts";
import { Session } from "../../src/modules/auth/sessions/session.model.ts";
import { Conversation } from "../../src/modules/conversations/conversation.model.ts";
import { Message } from "../../src/modules/messages/message.model.ts";
import { env } from "../../src/config/env.ts";

export function checkSafetyGuard(): void {
  const mongoUri = env.mongoUri;
  let dbName: string;
  try {
    const parsed = new URL(mongoUri);
    dbName = parsed.pathname.replace(/^\//, "");
  } catch {
    dbName = "";
  }
  if (!dbName.endsWith("_test")) {
    throw new Error(
      `Safety guard violation: database name must end with '_test' (got '${dbName}')`,
    );
  }
}

export async function connectTestDB(): Promise<void> {
  checkSafetyGuard();
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(env.mongoUri);
  }
  await Promise.all([
    User.createIndexes(),
    Session.createIndexes(),
    Conversation.createIndexes(),
  ]);
}

export async function clearTestDB(): Promise<void> {
  checkSafetyGuard();
  await Promise.all([
    User.deleteMany({}),
    Session.deleteMany({}),
    Conversation.deleteMany({}),
    Message.deleteMany({}),
  ]);
}

export async function disconnectTestDB(): Promise<void> {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}
