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
  TEST_GROUP_CONVERSATION,
  TEST_GROUP_CONVERSATION_ID,
  TEST_MESSAGES_NEWEST_FIRST,
  TEST_OTHER_USER_ID,
  TEST_PUBLIC_PROFILES,
  TEST_SEARCH_USERS,
  TEST_SECOND_CONVERSATION_ID,
  TEST_THIRD_USER_ID,
  TEST_USER,
} from "@/test/msw/fixtures";
import { mswServer } from "@/test/msw/server";
import { renderAppAt } from "@/test/render-app";
import {
  conversationUpdateSchema,
  directConversationSchema,
  groupConversationSchema,
  userSearchQuerySchema,
  type Conversation,
} from "@/types/conversations";

describe("conversations schemas & cache helpers", () => {
  it("validates user search, direct, group, and update schemas", () => {
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

    expect(
      groupConversationSchema.safeParse({
        type: "group",
        name: "فريق التصميم",
        participantIds: [TEST_SEARCH_USERS[0].id],
      }).success,
    ).toBe(true);
    expect(
      groupConversationSchema.safeParse({
        type: "group",
        name: "   ",
        participantIds: [TEST_SEARCH_USERS[0].id],
      }).success,
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
    let conversations: Conversation[] = [...TEST_CONVERSATIONS];
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
        const body = (await request.json()) as {
          type?: "direct" | "group";
          participantId?: string;
        };
        const matched = TEST_SEARCH_USERS.find(
          (u) => u.id === body.participantId,
        );
        const now = "2026-11-12T16:00:00.000Z";
        const created: Conversation = {
          _id: "65f1a9c2e4b0a1b2c3d4e699",
          type: "direct",
          participants: [
            { userId: TEST_USER.id, role: "member", joinedAt: now },
            {
              userId: body.participantId ?? TEST_OTHER_USER_ID,
              role: "member",
              joinedAt: now,
            },
          ],
          hiddenFor: [],
          name: matched?.displayName ?? "محادثة جديدة",
          avatarUrl: null,
          lastMessageAt: now,
          createdAt: now,
          updatedAt: now,
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

  it("creates a group, opens GroupDetailsDialog from header, enforces admin vs member controls, and leaves group", async () => {
    let conversations: Conversation[] = [
      ...TEST_CONVERSATIONS,
      TEST_GROUP_CONVERSATION,
    ];

    mswServer.use(
      http.get("*/api/conversations", () =>
        HttpResponse.json({ conversations }),
      ),
      http.post("*/api/users/batch", async ({ request }) => {
        const body = (await request.json()) as { userIds: string[] };
        const idSet = new Set(body.userIds);
        return HttpResponse.json({
          users: TEST_PUBLIC_PROFILES.filter((u) => idSet.has(u.id)),
        });
      }),
      http.get("*/api/users/search", ({ request }) => {
        const q = new URL(request.url).searchParams.get("q") ?? "";
        return HttpResponse.json({
          users: TEST_SEARCH_USERS.filter(
            (u) => u.username.includes(q) || u.displayName.includes(q),
          ),
        });
      }),
      http.post("*/api/conversations", async ({ request }) => {
        const body = (await request.json()) as {
          type?: "direct" | "group";
          name?: string;
          participantIds?: string[];
          participantId?: string;
        };
        if (body.type === "group") {
          const now = "2026-11-12T17:00:00.000Z";
          const created: Conversation = {
            _id: "65f1a9c2e4b0a1b2c3d4e690",
            type: "group",
            createdBy: TEST_USER.id,
            participants: [
              { userId: TEST_USER.id, role: "admin", joinedAt: now },
              ...(body.participantIds ?? []).map((id) => ({
                userId: id,
                role: "member" as const,
                joinedAt: now,
              })),
            ],
            hiddenFor: [],
            name: body.name ?? "مجموعة",
            avatarUrl: null,
            lastMessageAt: now,
            createdAt: now,
            updatedAt: now,
          };
          conversations = [created, ...conversations];
          return HttpResponse.json({ conversation: created }, { status: 201 });
        }
        return HttpResponse.json({ conversation: TEST_CONVERSATIONS[0] });
      }),
      http.patch(
        "*/api/conversations/:conversationId",
        async ({ params, request }) => {
          const body = (await request.json()) as {
            name?: string | null;
            avatarUrl?: string | null;
          };
          conversations = conversations.map((c) =>
            c._id === params.conversationId
              ? {
                  ...c,
                  ...(body.name !== undefined ? { name: body.name } : {}),
                  ...(body.avatarUrl !== undefined
                    ? { avatarUrl: body.avatarUrl }
                    : {}),
                }
              : c,
          );
          const updated = conversations.find(
            (c) => c._id === params.conversationId,
          );
          return HttpResponse.json({ conversation: updated });
        },
      ),
      http.put(
        "*/api/conversations/:conversationId/avatar",
        ({ params }) => {
          conversations = conversations.map((c) =>
            c._id === params.conversationId
              ? { ...c, avatarUrl: "data:image/png;base64,iVBORw0KGgo=" }
              : c,
          );
          const updated = conversations.find(
            (c) => c._id === params.conversationId,
          );
          return HttpResponse.json({ conversation: updated });
        },
      ),
      http.delete(
        "*/api/conversations/:conversationId/avatar",
        ({ params }) => {
          conversations = conversations.map((c) =>
            c._id === params.conversationId ? { ...c, avatarUrl: null } : c,
          );
          const updated = conversations.find(
            (c) => c._id === params.conversationId,
          );
          return HttpResponse.json({ conversation: updated });
        },
      ),
      http.patch(
        "*/api/conversations/:conversationId/participants/:userId/role",
        async ({ params, request }) => {
          const body = (await request.json()) as { role: "admin" | "member" };
          conversations = conversations.map((c) =>
            c._id === params.conversationId
              ? {
                  ...c,
                  participants: c.participants.map((p) =>
                    p.userId === params.userId ? { ...p, role: body.role } : p,
                  ),
                }
              : c,
          );
          const updated = conversations.find(
            (c) => c._id === params.conversationId,
          );
          return HttpResponse.json({ conversation: updated });
        },
      ),
      http.delete(
        "*/api/conversations/:conversationId/participants/:userId",
        ({ params }) => {
          conversations = conversations.map((c) =>
            c._id === params.conversationId
              ? {
                  ...c,
                  participants: c.participants.filter(
                    (p) => p.userId !== params.userId,
                  ),
                }
              : c,
          );
          const updated = conversations.find(
            (c) => c._id === params.conversationId,
          );
          return HttpResponse.json({ conversation: updated });
        },
      ),
      http.post("*/api/conversations/:conversationId/leave", ({ params }) => {
        conversations = conversations.filter(
          (c) => c._id !== params.conversationId,
        );
        return new HttpResponse(null, { status: 204 });
      }),
    );

    // 1. Open group as admin (TEST_USER)
    const { router } = renderAppAt(
      `/conversations/${TEST_GROUP_CONVERSATION_ID}`,
    );

    const headerButton = await screen.findByRole("button", {
      name: "تفاصيل المجموعة فريق التطوير",
    });
    fireEvent.click(headerButton);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("تغيير الصورة")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "تغيير اسم المجموعة" }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("إضافة أعضاء")).toBeInTheDocument();
    expect(await within(dialog).findByText("سارة علي")).toBeInTheDocument();

    // Upload & remove group avatar file as admin
    const avatarInput = within(dialog).getByLabelText(
      "اختيار صورة المجموعة",
    ) as HTMLInputElement;
    const validPngFile = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      "group.png",
      { type: "image/png" },
    );
    fireEvent.change(avatarInput, { target: { files: [validPngFile] } });

    const removeAvatarBtn = await within(dialog).findByRole("button", {
      name: "إزالة الصورة",
    });
    fireEvent.click(removeAvatarBtn);
    await waitFor(() => {
      expect(
        within(dialog).queryByRole("button", { name: "إزالة الصورة" }),
      ).not.toBeInTheDocument();
    });

    // Click member row as admin -> sees DM, Promote, Kick
    const saraRow = await within(dialog).findByRole("button", {
      name: /سارة علي/,
    });
    fireEvent.click(saraRow);

    expect(
      await screen.findByText("إرسال رسالة على الخاص"),
    ).toBeInTheDocument();
    expect(screen.getByText("ترقية إلى مشرف")).toBeInTheDocument();
    expect(screen.getByText("طرد من المجموعة")).toBeInTheDocument();

    // Promote Sara to admin -> also closes Sara's dropdown menu
    fireEvent.click(screen.getByText("ترقية إلى مشرف"));
    await waitFor(() => {
      expect(screen.queryByText("طرد من المجموعة")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(within(saraRow).getByText("مشرف")).toBeInTheDocument();
    });

    // Kick Omar
    const omarRow = within(dialog).getByRole("button", {
      name: /عمر خالد/,
    });
    fireEvent.click(omarRow);
    fireEvent.click(await screen.findByText("طرد من المجموعة"));

    await waitFor(() => {
      expect(
        within(dialog).queryByText("عمر خالد"),
      ).not.toBeInTheDocument();
    });

    // Leave group -> redirects to /
    fireEvent.click(
      within(dialog).getByRole("button", { name: "مغادرة المجموعة" }),
    );
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
  });

  it("hides admin-only controls in GroupDetailsDialog for non-admin members", async () => {
    const memberGroup: Conversation = {
      ...TEST_GROUP_CONVERSATION,
      _id: "65f1a9c2e4b0a1b2c3d4e609",
      participants: [
        {
          userId: TEST_OTHER_USER_ID,
          role: "admin",
          joinedAt: "2026-11-12T09:00:00.000Z",
        },
        {
          userId: TEST_USER.id,
          role: "member",
          joinedAt: "2026-11-12T09:00:00.000Z",
        },
        {
          userId: TEST_THIRD_USER_ID,
          role: "member",
          joinedAt: "2026-11-12T09:00:00.000Z",
        },
      ],
    };

    mswServer.use(
      http.get("*/api/conversations", () =>
        HttpResponse.json({ conversations: [memberGroup] }),
      ),
      http.post("*/api/users/batch", async ({ request }) => {
        const body = (await request.json()) as { userIds: string[] };
        const idSet = new Set(body.userIds);
        return HttpResponse.json({
          users: TEST_PUBLIC_PROFILES.filter((u) => idSet.has(u.id)),
        });
      }),
    );

    renderAppAt(`/conversations/${memberGroup._id}`);

    const headerButton = await screen.findByRole("button", {
      name: "تفاصيل المجموعة فريق التطوير",
    });
    fireEvent.click(headerButton);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByText("تغيير الصورة")).not.toBeInTheDocument();
    expect(
      within(dialog).queryByRole("button", { name: "تغيير اسم المجموعة" }),
    ).not.toBeInTheDocument();
    expect(within(dialog).queryByText("إضافة أعضاء")).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "مغادرة المجموعة" }),
    ).toBeInTheDocument();

    // Clicking a member as non-admin shows ONLY DM option (no kick or role change)
    const saraRow = await within(dialog).findByRole("button", {
      name: /سارة علي/,
    });
    fireEvent.click(saraRow);

    expect(
      await screen.findByText("إرسال رسالة على الخاص"),
    ).toBeInTheDocument();
    expect(screen.queryByText("طرد من المجموعة")).not.toBeInTheDocument();
    expect(screen.queryByText("ترقية إلى مشرف")).not.toBeInTheDocument();
  });

  it("hides empty conversations from the sidebar until a message is sent", async () => {
    const emptyDirectConversation: Conversation = {
      _id: "65f1a9c2e4b0a1b2c3d4e698",
      type: "direct",
      participants: [
        { userId: TEST_USER.id, role: "member", joinedAt: "2026-11-12T10:00:00.000Z" },
        {
          userId: TEST_OTHER_USER_ID,
          role: "member",
          joinedAt: "2026-11-12T10:00:00.000Z",
        },
      ],
      hiddenFor: [],
      name: "محادثة فارغة",
      avatarUrl: null,
      lastMessageAt: null,
      createdAt: "2026-11-12T10:00:00.000Z",
      updatedAt: "2026-11-12T10:00:00.000Z",
    };

    mswServer.use(
      http.get("*/api/conversations", () =>
        HttpResponse.json({
          conversations: [emptyDirectConversation, TEST_CONVERSATIONS[0]],
        }),
      ),
    );

    renderAppAt("/");

    expect(await screen.findByText("سارة علي")).toBeInTheDocument();
    expect(screen.queryByText("محادثة فارغة")).not.toBeInTheDocument();
  });
});
