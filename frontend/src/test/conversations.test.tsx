import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import {
  removeConversationFromCache,
  sortConversationsByActivity,
  updateConversationLastMessageInCache,
  upsertConversationInCache,
} from "@/features/conversations";
import {
  TEST_CONVERSATION_ID,
  TEST_CONVERSATIONS,
  TEST_MESSAGES_NEWEST_FIRST,
  TEST_SEARCH_USERS,
  TEST_SECOND_CONVERSATION_ID,
  TEST_USER,
} from "@/test/msw/fixtures";
import { mswServer } from "@/test/msw/server";
import { renderAppAt } from "@/test/render-app";
import {
  conversationUpdateSchema,
  directConversationSchema,
  userSearchQuerySchema,
} from "@/types/conversations";

describe("conversations schemas & cache helpers", () => {
  it("validates user search, direct conversation, and update schemas", () => {
    expect(userSearchQuerySchema.safeParse({ q: "  سارة  " }).success).toBe(
      true,
    );
    expect(userSearchQuerySchema.safeParse({ q: "   " }).success).toBe(false);

    expect(
      directConversationSchema.safeParse({
        participantId: TEST_SEARCH_USERS[0].id,
      }).success,
    ).toBe(true);
    expect(
      directConversationSchema.safeParse({ participantId: "invalid-id" })
        .success,
    ).toBe(false);

    expect(conversationUpdateSchema.safeParse({}).success).toBe(false);
    expect(conversationUpdateSchema.safeParse({ name: null }).success).toBe(
      true,
    );
  });

  it("sorts, upserts, updates lastMessage, and removes conversations in cache", () => {
    const olderFirst = [TEST_CONVERSATIONS[1], TEST_CONVERSATIONS[0]];
    const sorted = sortConversationsByActivity(olderFirst);
    expect(sorted.map((item) => item._id)).toEqual([
      TEST_CONVERSATION_ID,
      TEST_SECOND_CONVERSATION_ID,
    ]);

    const bumpedMessage = {
      ...TEST_MESSAGES_NEWEST_FIRST[0],
      _id: "65f1a9c2e4b0a1b2c3d4e888",
      conversationId: TEST_SECOND_CONVERSATION_ID,
      content: "رسالة جديدة ترفع المحادثة للأعلى",
      createdAt: "2026-11-12T15:00:00.000Z",
      updatedAt: "2026-11-12T15:00:00.000Z",
    };

    const updatedList = updateConversationLastMessageInCache(
      sorted,
      bumpedMessage,
    );
    expect(updatedList?.[0]._id).toBe(TEST_SECOND_CONVERSATION_ID);
    expect(updatedList?.[0].lastMessage?.content).toBe(
      "رسالة جديدة ترفع المحادثة للأعلى",
    );

    const renamed = upsertConversationInCache(updatedList, {
      ...TEST_CONVERSATIONS[0],
      name: "مجموعة العمل",
    });
    expect(
      renamed.find((item) => item._id === TEST_CONVERSATION_ID)?.name,
    ).toBe("مجموعة العمل");

    const afterRemove = removeConversationFromCache(
      renamed,
      TEST_CONVERSATION_ID,
    );
    expect(afterRemove?.map((item) => item._id)).toEqual([
      TEST_SECOND_CONVERSATION_ID,
    ]);
  });
});

describe("conversations UI flows", () => {
  it("lists conversations, filters locally, creates new direct chat via user search, renames, and hides", async () => {
    let conversations = [...TEST_CONVERSATIONS];
    const searchQueries: string[] = [];

    mswServer.use(
      http.get("*/api/conversations", () =>
        HttpResponse.json({ conversations }),
      ),
      http.get("*/api/users/search", ({ request }) => {
        const url = new URL(request.url);
        const q = url.searchParams.get("q") ?? "";
        searchQueries.push(q);
        return HttpResponse.json({
          users: TEST_SEARCH_USERS.filter(
            (u) =>
              u.username.includes(q) ||
              u.displayName.includes(q) ||
              u.email.includes(q),
          ),
        });
      }),
      http.post("*/api/conversations", async ({ request }) => {
        const body = (await request.json()) as { participantId: string };
        const matched = TEST_SEARCH_USERS.find(
          (u) => u.id === body.participantId,
        );
        const created = {
          _id: "65f1a9c2e4b0a1b2c3d4e699",
          type: "direct" as const,
          participantIds: [TEST_USER.id, body.participantId],
          hiddenFor: [],
          name: matched?.displayName ?? "محادثة جديدة",
          avatarUrl: null,
          lastMessageAt: "2026-11-12T16:00:00.000Z",
          createdAt: "2026-11-12T16:00:00.000Z",
          updatedAt: "2026-11-12T16:00:00.000Z",
        };
        conversations = [created, ...conversations];
        return HttpResponse.json({ conversation: created }, { status: 201 });
      }),
      http.patch(
        "*/api/conversations/:conversationId",
        async ({ params, request }) => {
          const body = (await request.json()) as { name?: string | null };
          conversations = conversations.map((c) =>
            c._id === params.conversationId
              ? { ...c, name: body.name ?? null }
              : c,
          );
          const updated = conversations.find(
            (c) => c._id === params.conversationId,
          );
          return HttpResponse.json({ conversation: updated });
        },
      ),
      http.post("*/api/conversations/:conversationId/hide", ({ params }) => {
        conversations = conversations.filter(
          (c) => c._id !== params.conversationId,
        );
        return new HttpResponse(null, { status: 204 });
      }),
    );

    const { router } = renderAppAt("/");

    expect(await screen.findByText("سارة علي")).toBeInTheDocument();
    expect(screen.getByText("عمر خالد")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("تصفية المحادثات"), {
      target: { value: "عمر" },
    });
    expect(screen.queryByText("سارة علي")).not.toBeInTheDocument();
    expect(screen.getByText("عمر خالد")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("تصفية المحادثات"), {
      target: { value: "" },
    });

    const sidebar = screen.getByRole("complementary", {
      name: "قائمة المحادثات",
    });
    fireEvent.click(
      within(sidebar).getByRole("button", { name: "محادثة جديدة" }),
    );
    const searchInput = await screen.findByLabelText("بحث عن مستخدم");
    fireEvent.change(searchInput, { target: { value: "سارة" } });

    const candidateButton = await screen.findByRole("button", {
      name: /سارة علي/,
    });
    expect(searchQueries).toContain("سارة");
    fireEvent.click(candidateButton);

    await waitFor(() => {
      expect(router.state.location.pathname).toBe(
        "/conversations/65f1a9c2e4b0a1b2c3d4e699",
      );
    });

    const settingsButton = await screen.findByRole("button", {
      name: "إعدادات المحادثة",
    });
    fireEvent.click(settingsButton);
    fireEvent.click(await screen.findByText("تعديل الاسم"));

    const renameInput = await screen.findByLabelText("اسم المحادثة");
    expect(renameInput).toHaveAttribute("dir", "rtl");
    fireEvent.change(renameInput, { target: { value: "فريق التسويق" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "فريق التسويق" }),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "إعدادات المحادثة" }));
    fireEvent.click(await screen.findByText("إخفاء المحادثة"));

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
  });
});
