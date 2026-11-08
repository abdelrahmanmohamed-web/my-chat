import mongoose, { Schema, type Document } from "mongoose";

export interface ISession extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  name: string;
  refreshTokenHash: string;
  currentVersion: number;
  activeAccessTokenId: string;
  device: string;
  ip: string;
  userAgent: string;
  lastActiveAt: Date;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    name: {
      type: String,
      default: "Unnamed Session",
      trim: true,
      maxlength: 100,
    },
    refreshTokenHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    currentVersion: {
      type: Number,
      default: 1,
      required: true,
    },
    activeAccessTokenId: {
      type: String,
      required: true,
    },
    device: {
      type: String,
      default: "Unknown Device",
      trim: true,
      maxlength: 150,
    },
    ip: {
      type: String,
      default: "Unknown IP",
      trim: true,
      maxlength: 50,
    },
    userAgent: {
      type: String,
      default: "Unknown Agent",
      trim: true,
      maxlength: 300,
    },
    lastActiveAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true },
);

// TTL index to automatically purge expired sessions
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Compound indexes for listing a user's active sessions quickly
sessionSchema.index({ userId: 1, createdAt: -1 });
sessionSchema.index({ userId: 1, expiresAt: -1 });

export const Session =
  mongoose.models.Session || mongoose.model<ISession>("Session", sessionSchema);
