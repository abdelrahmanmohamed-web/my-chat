import { StrictMode } from "react";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router";
import { VirtuosoMockContext } from "react-virtuoso";
import { AppProviders } from "@/app/providers";
import { queryClient, QUERY_KEYS } from "@/app/query-client";
import { useAuthStore, useConnectionStore } from "@/stores";
import type { Message } from "@/types/messages";
import { createFakeRealtimeSocket } from "./fake-socket";
import {
  TEST_CONVERSATION_ID,
  TEST_CONVERSATIONS,
  TEST_MESSAGES_NEWEST_FIRST,
  TEST_OTHER_USER_ID,
  TEST_SECOND_CONVERSATION_ID,
  TEST_USER,
} from "./msw/fixtures";
import { mswServer } from "./msw/server";
import { eagerAppRoutes, renderAppAt } from "./render-app";

describe("Phase 3 realtime & socket integration", () => {
  it("registers listeners cleanly under StrictMode and connects only when authenticated", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    const router = createMemoryRouter(eagerAppRoutes, {
      initialEntries: ["/login"],
    });

    mswServer.use(
      http.post("*/api/auth/refresh", () =>
        HttpResponse.json({ error: "Unauthorized" }, { status: 401 }),
      ),
    );

    const view = render(
      <StrictMode>
        <VirtuosoMockContext.Provider
          value={{ viewportHeight: 600, itemHeight: 80 }}
        >
          <AppProviders socketInstance={fakeSocket}>
            <RouterProvider router={router} />
          </AppProviders>
        </VirtuosoMockContext.Provider>
      </StrictMode>,
    );

    await screen.findByRole("button", { name: "دخول" });
    expect(fakeSocket.connectCalls).toBe(0);
    expect(fakeSocket.listenerCount("message:new")).toBe(1);
    expect(fakeSocket.listenerCount("connect")).toBe(1);

    act(() => {
      useAuthStore.getState().setSession({
        accessToken: "fresh-token",
        user: TEST_USER,
      });
    });

    await waitFor(() => {
      expect(fakeSocket.connectCalls).toBe(1);
    });
    expect(useConnectionStore.getState().status).toBe("connecting");

    act(() => {
      fakeSocket.simulateConnect("polling");
    });
    expect(await screen.findByText("متصل (استطلاع)")).toBeInTheDocument();

    act(() => {
      fakeSocket.simulateUpgrade("websocket");
    });
    expect(await screen.findByText("متصل مباشر")).toBeInTheDocument();

    act(() => {
      useAuthStore.getState().clearAuth();
    });
    await waitFor(() => {
      expect(fakeSocket.disconnectCalls).toBeGreaterThanOrEqual(1);
    });

    view.unmount();
    expect(fakeSocket.listenerCount("message:new")).toBe(0);
    expect(fakeSocket.listenerCount("message:read_update")).toBe(0);
    expect(fakeSocket.listenerCount("connect")).toBe(0);
    expect(fakeSocket.engineUpgradeListenerCount()).toBe(0);
  });

  it("joins/leaves conversation rooms, dedupes double message:new delivery, and updates read receipts in realtime", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    let conversationsFetchCount = 0;
    let messagesFetchCount = 0;

    mswServer.use(
      http.get("*/api/conversations", () => {
        conversationsFetchCount += 1;
        return HttpResponse.json({ conversations: TEST_CONVERSATIONS });
      }),
      http.get("*/api/conversations/:conversationId/messages", ({ params }) => {
        messagesFetchCount += 1;
        if (params.conversationId === TEST_CONVERSATION_ID) {
          return HttpResponse.json({
            messages: TEST_MESSAGES_NEWEST_FIRST,
            nextCursor: null,
          });
        }
        return HttpResponse.json({ messages: [], nextCursor: null });
      }),
    );

    const { router } = renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);
    expect(fakeSocket.connectCalls).toBe(1);

    act(() => {
      fakeSocket.simulateConnect("websocket");
    });

    await waitFor(() => {
      expect(fakeSocket.emitted).toContainEqual({
        event: "join:conversation",
        args: [TEST_CONVERSATION_ID, expect.any(Function)],
      });
      expect(conversationsFetchCount).toBeGreaterThanOrEqual(2);
      expect(messagesFetchCount).toBeGreaterThanOrEqual(2);
    });

    // Server broadcasts the same message twice (conversation:<id> + user:<id>)
    const incomingMessage: Message = {
      _id: "65f1a9c2e4b0a1b2c3d4e888",
      conversationId: TEST_CONVERSATION_ID,
      senderId: TEST_OTHER_USER_ID,
      content: "رسالة لحظية بدون تكرار",
      clientId: "cid-realtime-1",
      reads: [],
      expiresAt: null,
      createdAt: "2026-11-12T12:20:00.000Z",
      updatedAt: "2026-11-12T12:20:00.000Z",
    };

    act(() => {
      fakeSocket.emitServerEvent("message:new", {
        conversationId: TEST_CONVERSATION_ID,
        message: incomingMessage,
      });
      fakeSocket.emitServerEvent("message:new", {
        conversationId: TEST_CONVERSATION_ID,
        message: incomingMessage,
      });
    });

    const chatRegion = screen.getByRole("region", { name: "سارة علي" });
    const renderedIncoming = await within(chatRegion).findAllByText(
      "رسالة لحظية بدون تكرار",
    );
    expect(renderedIncoming).toHaveLength(1);

    // Second conversation receives a message while not opened in timeline cache:
    // sidebar updates & moves to top, while messages cache stays unset until opened.
    const otherConvMessage: Message = {
      _id: "65f1a9c2e4b0a1b2c3d4e889",
      conversationId: TEST_SECOND_CONVERSATION_ID,
      senderId: "65f1a9c2e4b0a1b2c3d4e503",
      content: "رسالة في المحادثة الثانية",
      clientId: null,
      reads: [],
      expiresAt: null,
      createdAt: "2026-11-12T12:25:00.000Z",
      updatedAt: "2026-11-12T12:25:00.000Z",
    };

    act(() => {
      fakeSocket.emitServerEvent("message:new", {
        conversationId: TEST_SECOND_CONVERSATION_ID,
        message: otherConvMessage,
      });
    });

    expect(
      await screen.findByText("رسالة في المحادثة الثانية"),
    ).toBeInTheDocument();
    expect(
      queryClient.getQueryData(
        QUERY_KEYS.messages(TEST_SECOND_CONVERSATION_ID),
      ),
    ).toBeUndefined();

    const cachedConversations = queryClient.getQueryData<
      typeof TEST_CONVERSATIONS
    >(QUERY_KEYS.conversations);
    expect(cachedConversations?.[0]._id).toBe(TEST_SECOND_CONVERSATION_ID);

    // Realtime read update arrives for user's own message
    const ownIncomingConfirmed: Message = {
      _id: "65f1a9c2e4b0a1b2c3d4e890",
      conversationId: TEST_CONVERSATION_ID,
      senderId: TEST_USER.id,
      content: "رسالتي بانتظار القراءة",
      clientId: "cid-own-1",
      reads: [],
      expiresAt: null,
      createdAt: "2026-11-12T12:26:00.000Z",
      updatedAt: "2026-11-12T12:26:00.000Z",
    };

    act(() => {
      fakeSocket.emitServerEvent("message:new", {
        conversationId: TEST_CONVERSATION_ID,
        message: ownIncomingConfirmed,
      });
    });

    expect(
      await within(chatRegion).findByText("رسالتي بانتظار القراءة"),
    ).toBeInTheDocument();
    expect(within(chatRegion).getAllByLabelText("مقروء")).toHaveLength(1);
    expect(within(chatRegion).getAllByLabelText("تم الإرسال")).toHaveLength(1);

    act(() => {
      fakeSocket.emitServerEvent("message:read_update", {
        conversationId: TEST_CONVERSATION_ID,
        userId: TEST_OTHER_USER_ID,
        lastReadMessageId: ownIncomingConfirmed._id,
      });
    });

    await waitFor(() => {
      expect(within(chatRegion).getAllByLabelText("مقروء")).toHaveLength(2);
    });

    // Navigating away emits leave:conversation
    await act(async () => {
      await router.navigate("/");
    });

    await waitFor(() => {
      expect(fakeSocket.emitted).toContainEqual({
        event: "leave:conversation",
        args: [TEST_CONVERSATION_ID],
      });
    });
  });

  it("reconnects on io server disconnect, rejoins open room, refetches missed events, and redirects when join is forbidden", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    let conversationsFetchCount = 0;
    let messagesFetchCount = 0;

    mswServer.use(
      http.get("*/api/conversations", () => {
        conversationsFetchCount += 1;
        return HttpResponse.json({ conversations: TEST_CONVERSATIONS });
      }),
      http.get("*/api/conversations/:conversationId/messages", () => {
        messagesFetchCount += 1;
        return HttpResponse.json({
          messages: TEST_MESSAGES_NEWEST_FIRST,
          nextCursor: null,
        });
      }),
    );

    const { router } = renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);

    act(() => {
      fakeSocket.simulateConnect("websocket");
    });

    await waitFor(() => {
      expect(conversationsFetchCount).toBeGreaterThanOrEqual(2);
      expect(messagesFetchCount).toBeGreaterThanOrEqual(2);
    });

    const prevConvsFetches = conversationsFetchCount;
    const prevMsgsFetches = messagesFetchCount;
    const prevConnectCalls = fakeSocket.connectCalls;

    // Server-initiated disconnect triggers manual connect()
    act(() => {
      fakeSocket.simulateDisconnect("io server disconnect", false);
    });

    expect(fakeSocket.connectCalls).toBe(prevConnectCalls + 1);
    expect(await screen.findByText("إعادة الاتصال...")).toBeInTheDocument();

    // Reconnect re-joins active room and invalidates conversations + active messages
    act(() => {
      fakeSocket.simulateConnect("websocket");
    });

    await waitFor(() => {
      const joins = fakeSocket.emitted.filter(
        (entry) =>
          entry.event === "join:conversation" &&
          entry.args[0] === TEST_CONVERSATION_ID,
      );
      expect(joins.length).toBeGreaterThanOrEqual(2);
      expect(conversationsFetchCount).toBeGreaterThan(prevConvsFetches);
      expect(messagesFetchCount).toBeGreaterThan(prevMsgsFetches);
    });

    // Forbidden join on another conversation redirects back to / with toast
    fakeSocket.joinAckResolver = (id) =>
      id === TEST_SECOND_CONVERSATION_ID
        ? { status: "error", error: "Forbidden: Not a participant" }
        : { status: "ok", data: { conversationId: id } };

    await act(async () => {
      await router.navigate(`/conversations/${TEST_SECOND_CONVERSATION_ID}`);
    });

    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/");
    });
    expect(
      await screen.findByText("ليس لديك صلاحية الوصول إلى هذه المحادثة."),
    ).toBeInTheDocument();
  });
});
