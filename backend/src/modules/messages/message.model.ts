import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const messageSchema = new Schema(
  {
    conversationId: {
      type: Schema.Types.ObjectId,
      ref: "Conversation",
      required: true,
      index: true,
    },
    senderId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
    clientId: {
      type: String,
      default: null,
      trim: true,
    },
    reads: [
      {
        userId: { type: Schema.Types.ObjectId, ref: "User" },
        lastReadMessageId: { type: Schema.Types.ObjectId, ref: "Message" },
      },
    ],
    expiresAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

messageSchema.index({
  conversationId: 1,
  createdAt: -1,
  _id: -1,
});

messageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

messageSchema.index(
  { senderId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: "string" } } },
);

export const Message = models.Message || model("Message", messageSchema);
