import mongoose, { type InferSchemaType, type Model, type Types } from "mongoose";

const { Schema, model, models } = mongoose;

export const MAX_GROUP_PARTICIPANTS = 100;

export type ConversationType = "direct" | "group";
export type ParticipantRole = "admin" | "member";

const participantSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    role: {
      type: String,
      enum: ["admin", "member"],
      default: "member",
      required: true,
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
    lastReadMessageId: {
      type: Schema.Types.ObjectId,
      ref: "Message",
      default: null,
    },
  },
  { _id: false },
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
    participants: {
      type: [participantSchema],
      required: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    hiddenFor: {
      type: [Schema.Types.ObjectId],
      ref: "User",
      default: [],
    },
    name: { type: String, default: null, trim: true },
    avatarUrl: { type: String, default: null },
    lastMessageAt: { type: Date, default: null },
    lastMessage: {
      messageId: { type: Schema.Types.ObjectId, ref: "Message" },
      senderId: { type: Schema.Types.ObjectId, ref: "User" },
      content: { type: String, maxlength: 200 },
    },
  },
  { timestamps: true },
);

conversationSchema.pre("validate", function () {
  const seenUserIds = new Set<string>();
  for (const participant of this.participants) {
    if (!participant.userId) {
      throw new Error("All participants must have a userId");
    }
    const idStr = participant.userId.toString();
    if (seenUserIds.has(idStr)) {
      throw new Error("Duplicate participants are not allowed");
    }
    seenUserIds.add(idStr);
  }

  if (this.type === "direct") {
    if (this.participants.length !== 2) {
      throw new Error("Direct conversation must have exactly 2 participants");
    }
    if (this.participants.some((p) => p.role !== "member")) {
      throw new Error(
        "Direct conversation participants must all have role 'member'",
      );
    }
    if (!this.directKey) {
      throw new Error("Direct conversation requires directKey");
    }
  } else if (this.type === "group") {
    if (typeof this.name !== "string" || this.name.trim().length === 0) {
      throw new Error("Group conversation requires a non-empty name");
    }
    const minParticipants = this.isNew ? 2 : 1;
    if (this.participants.length < minParticipants) {
      throw new Error(
        `Group conversation must have at least ${minParticipants} participants`,
      );
    }
    if (this.participants.length > MAX_GROUP_PARTICIPANTS) {
      throw new Error(
        `Group conversation cannot exceed ${MAX_GROUP_PARTICIPANTS} participants`,
      );
    }
    if (!this.participants.some((p) => p.role === "admin")) {
      throw new Error("Group conversation must have at least one admin");
    }
    if (this.directKey !== undefined && this.directKey !== null) {
      throw new Error("Group conversation must not have directKey");
    }
  }
});

conversationSchema.index(
  { directKey: 1 },
  {
    unique: true,
    partialFilterExpression: { directKey: { $type: "string" } },
    name: "unique_direct_conversation",
  },
);

conversationSchema.index({ "participants.userId": 1, lastMessageAt: -1 });

export type ConversationSchemaType = InferSchemaType<typeof conversationSchema> & {
  _id: Types.ObjectId;
};

export const Conversation: Model<ConversationSchemaType> =
  (models.Conversation as Model<ConversationSchemaType> | undefined) ||
  model<ConversationSchemaType>("Conversation", conversationSchema);
