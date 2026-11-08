import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const userSchema = new Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    passwordHash: {
      type: String,
      required: true,
      select: false,
    },
    username: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["online", "offline"],
      default: "offline",
    },
    avatarUrl: {
      type: String,
      default: null,
    },
    maxSessions: {
      type: Number,
      default: 3,
      min: 1,
      max: 10,
    },
  },
  { timestamps: true },
);

export const User = models.User || model("User", userSchema);
