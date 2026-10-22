import mongoose from "mongoose";

const { Schema, model, models } = mongoose;

const participantSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["member", "admin"],
      default: "member",
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false }
);

const conversationSchema = new Schema(
  {
    type: {
      type: String,
      enum: ["direct", "group"],
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
    participants: {
      type: [participantSchema],
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
    autoDeleteAfterSeconds: {
      type: Number,
      default: null,
      min: 1,
    },
  },
  { timestamps: true }
);

conversationSchema.index(
  { directKey: 1 },
  {
    unique: true,
    partialFilterExpression: { type: "direct" },
    name: "unique_direct_conversation",
  }
);

conversationSchema.index({ participantIds: 1 });

export const Conversation =
  models.Conversation ||
  model("Conversation", conversationSchema);
