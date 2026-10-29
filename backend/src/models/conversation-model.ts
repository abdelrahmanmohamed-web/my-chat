import mongoose from "mongoose";

const { Schema, model, models } = mongoose;


const conversationSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["direct"],
      required: true,
    },
    directKey: {
      type: String,
      default: undefined,
    },
    participantIds: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      required: true,
    },
    // Visibility is per participant; the conversation itself remains shared.
    hiddenFor: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },
    name: {
      type: String,
      default: null,
    },
    avatarUrl: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

conversationSchema.index(
  { directKey: 1 },
  {
    unique: true,
    partialFilterExpression: { type: "direct" },
    name: "unique_direct_conversation",
  },
);

conversationSchema.index({ participantIds: 1 });

export const Conversation =
  models.Conversation || model("Conversation", conversationSchema);
