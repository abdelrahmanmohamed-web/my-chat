import { fireEvent, screen, waitFor } from "@testing-library/react";
import { delay, http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  applyReadUpdateToCache,
  createOptimisticMessage,
  findHighestReadMessageIndex,
  flattenMessagesPages,
  insertOptimisticMessage,
  markOptimisticMessageFailed,
  parseMessageSegments,
  reconcileOptimisticMessage,
  upsertMessageInCache,
} from "@/features/chat";
import {
  TEST_CONVERSATION_ID,
  TEST_CONVERSATIONS,
  TEST_MESSAGES_NEWEST_FIRST,
  TEST_OTHER_USER_ID,
  TEST_USER,
} from "@/test/msw/fixtures";
import { mswServer } from "@/test/msw/server";
import { renderAppAt } from "@/test/render-app";
import { listMessagesQuerySchema, sendMessageSchema } from "@/types/messages";

describe("chat schemas, utils & message cache helpers", () => {
  it("validates message schemas and safely parses plain text links", () => {
    expect(sendMessageSchema.safeParse({ content: "  مرحباً  " }).success).toBe(
      true,
    );
    expect(sendMessageSchema.safeParse({ content: "   " }).success).toBe(false);
    expect(
      sendMessageSchema.safeParse({ content: "a".repeat(4001) }).success,
    ).toBe(false);

    expect(
      listMessagesQuerySchema.safeParse({
        cursor: TEST_MESSAGES_NEWEST_FIRST[0]._id,
        limit: 30,
      }).success,
    ).toBe(true);

    const segments = parseMessageSegments(
      "راجع https://example.com/docs! ثم رد علي",
    );
    expect(segments).toEqual([
      { type: "text", value: "راجع " },
      {
        type: "link",
        value: "https://example.com/docs",
        href: "https://example.com/docs",
      },
      { type: "text", value: "!" },
      { type: "text", value: " ثم رد علي" },
    ]);
  });

  it("handles optimistic insert, reconcile, fail, deduplicated upsert, flatten, and read index", () => {
    const baseData = {
      pages: [
        {
          messages: [TEST_MESSAGES_NEWEST_FIRST[0]],
          nextCursor: TEST_MESSAGES_NEWEST_FIRST[1]._id,
        },
        {
          messages: [
            TEST_MESSAGES_NEWEST_FIRST[0], // duplicate across page boundary
            TEST_MESSAGES_NEWEST_FIRST[1],
          ],
          nextCursor: null,
        },
      ],
      pageParams: [undefined, TEST_MESSAGES_NEWEST_FIRST[1]._id],
    };

    const optimistic = createOptimisticMessage({
      conversationId: TEST_CONVERSATION_ID,
      senderId: TEST_USER.id,
      content: "رسالة متفائلة",
      clientId: "cid-1",
    });

    const withOptimistic = insertOptimisticMessage(baseData, optimistic);
    expect(withOptimistic.pages[0].messages[0].localStatus).toBe("sending");

    const failed = markOptimisticMessageFailed(
      withOptimistic,
      "cid-1",
      "فشل الشبكة",
    );
    expect(failed?.pages[0].messages[0].localStatus).toBe("failed");
    expect(failed?.pages[0].messages[0].errorMessage).toBe("فشل الشبكة");

    const serverConfirmed = {
      ...optimistic,
      _id: "65f1a9c2e4b0a1b2c3d4e777",
      localStatus: undefined,
    };

    const reconciled = reconcileOptimisticMessage(
      failed,
      serverConfirmed,
      "cid-1",
    );
    const deduped = upsertMessageInCache(reconciled, serverConfirmed);
    const withRead = applyReadUpdateToCache(deduped, {
      userId: TEST_OTHER_USER_ID,
      lastReadMessageId: serverConfirmed._id,
    });

    const flattened = flattenMessagesPages(withRead);
    expect(flattened.map((item) => item._id)).toEqual([
      TEST_MESSAGES_NEWEST_FIRST[1]._id,
      TEST_MESSAGES_NEWEST_FIRST[0]._id,
      "65f1a9c2e4b0a1b2c3d4e777",
    ]);

    expect(findHighestReadMessageIndex(flattened, TEST_USER.id)).toBe(2);
  });
});

describe("chat REST baseline UI flows", () => {
  it("renders messages safely, auto-marks incoming read, sends optimistically, and retries failed messages with same clientId", async () => {
    const readCalls: string[] = [];
    const sentRequests: Array<{ content: string; clientId?: string }> = [];
    let shouldFailFirstSend = true;

    mswServer.use(
      http.get("*/api/conversations", () =>
        HttpResponse.json({ conversations: TEST_CONVERSATIONS }),
      ),
      http.get("*/api/conversations/:conversationId/messages", () =>
        HttpResponse.json({
          messages: TEST_MESSAGES_NEWEST_FIRST,
          nextCursor: null,
        }),
      ),
      http.patch(
        "*/api/conversations/:conversationId/messages/:messageId/read",
        ({ params }) => {
          readCalls.push(String(params.messageId));
          return HttpResponse.json({ status: "ok" });
        },
      ),
      http.post(
        "*/api/conversations/:conversationId/messages",
        async ({ params, request }) => {
          const body = (await request.json()) as {
            content: string;
            clientId?: string;
          };
          sentRequests.push(body);
          await delay(20);

          if (shouldFailFirstSend) {
            shouldFailFirstSend = false;
            return HttpResponse.json(
              { error: "Internal server error", message: "تعذر حفظ الرسالة" },
              { status: 500 },
            );
          }

          const now = "2026-11-12T12:15:00.000Z";
          return HttpResponse.json(
            {
              message: {
                _id: "65f1a9c2e4b0a1b2c3d4e799",
                conversationId: String(params.conversationId),
                senderId: TEST_USER.id,
                content: body.content,
                clientId: body.clientId ?? null,
                reads: [],
                expiresAt: null,
                createdAt: now,
                updatedAt: now,
              },
            },
            { status: 201 },
          );
        },
      ),
    );

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`);

    expect(
      await screen.findByText(/السلام عليكم <script>alert\(1\)<\/script>/),
    ).toBeInTheDocument();

    const safeLink = await screen.findByRole("link", {
      name: "https://example.com/docs",
    });
    expect(safeLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(safeLink).toHaveAttribute("href", "https://example.com/docs");

    await waitFor(() => {
      expect(readCalls).toEqual([TEST_MESSAGES_NEWEST_FIRST[0]._id]);
    });

    const composer = screen.getByLabelText("نص الرسالة");
    fireEvent.change(composer, { target: { value: "تجربة الإرسال المتفائل" } });
    fireEvent.click(screen.getByRole("button", { name: "إرسال الرسالة" }));

    expect(
      await screen.findByText("تجربة الإرسال المتفائل"),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "إعادة المحاولة" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إعادة المحاولة" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "إعادة المحاولة" }),
      ).not.toBeInTheDocument();
    });

    expect(sentRequests).toHaveLength(2);
    expect(sentRequests[0].clientId).toBeTruthy();
    expect(sentRequests[1].clientId).toBe(sentRequests[0].clientId);
    expect(sentRequests[1].content).toBe("تجربة الإرسال المتفائل");
  });
});
