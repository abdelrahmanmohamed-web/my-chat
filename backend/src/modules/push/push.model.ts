import mongoose, { Schema, type Document } from "mongoose";

export interface IPushSubscription extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
  userAgent: string;
  createdAt: Date;
  updatedAt: Date;
}

const pushSubscriptionSchema = new Schema<IPushSubscription>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    endpoint: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      maxlength: 2048,
    },
    keys: {
      p256dh: {
        type: String,
        required: true,
        trim: true,
      },
      auth: {
        type: String,
        required: true,
        trim: true,
      },
    },
    userAgent: {
      type: String,
      default: "Unknown Agent",
      trim: true,
      maxlength: 300,
    },
  },
  { timestamps: true },
);

export const PushSubscription =
  mongoose.models.PushSubscription ||
  mongoose.model<IPushSubscription>("PushSubscription", pushSubscriptionSchema);
