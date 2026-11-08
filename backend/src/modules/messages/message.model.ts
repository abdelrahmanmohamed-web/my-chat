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

export const Message = models.Message || model("Message", messageSchema);
