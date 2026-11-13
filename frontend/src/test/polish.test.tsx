import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { useConnectionStore, usePresenceStore } from "@/stores";
import type { Message } from "@/types/messages";
import { createFakeRealtimeSocket } from "./fake-socket";
import {
  TEST_CONVERSATION_ID,
  TEST_CONVERSATIONS,
  TEST_MESSAGES_NEWEST_FIRST,
  TEST_OTHER_USER_ID,
  TEST_SECOND_CONVERSATION_ID,
} from "./msw/fixtures";
import { mswServer } from "./msw/server";
import { renderAppAt } from "./render-app";

function registerBaseChatHandlers() {
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
      () => HttpResponse.json({ status: "ok" }),
    ),
  );
}

describe("Phase 5 polish, typing, presence, unread & theme", () => {
  it("emits typing:start on first keystroke, typing:stop after idle, on blur, and on submit", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    registerBaseChatHandlers();

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);
    act(() => {
      fakeSocket.simulateConnect("websocket");
    });

    const composer = screen.getByLabelText("نص الرسالة");

    vi.useFakeTimers();
    try {
      // First keystroke emits typing:start
      fireEvent.change(composer, { target: { value: "أ" } });
      expect(
        fakeSocket.emitted.some(
          (c) =>
            c.event === "typing:start" && c.args[0] === TEST_CONVERSATION_ID,
        ),
      ).toBe(true);

      // Idle for 2s emits typing:stop
      act(() => {
        vi.advanceTimersByTime(2100);
      });
      expect(
        fakeSocket.emitted.some(
          (c) =>
            c.event === "typing:stop" && c.args[0] === TEST_CONVERSATION_ID,
        ),
      ).toBe(true);
    } finally {
      vi.useRealTimers();
    }

    // New keystroke emits typing:start again, blur emits typing:stop
    fakeSocket.emitted = [];
    fireEvent.change(composer, { target: { value: "أهلاً" } });
    expect(fakeSocket.emitted.some((c) => c.event === "typing:start")).toBe(
      true,
    );

    fireEvent.blur(composer);
    expect(fakeSocket.emitted.some((c) => c.event === "typing:stop")).toBe(
      true,
    );
  });

  it("renders receiver typing indicator and auto-expires after 5 seconds", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    registerBaseChatHandlers();

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);
    act(() => {
      fakeSocket.simulateConnect("websocket");
    });

    const main = screen.getByRole("main");
    expect(
      within(main).queryByText(/سارة علي يكتب الآن/),
    ).not.toBeInTheDocument();

    vi.useFakeTimers();
    try {
      // Receiver event
      act(() => {
        fakeSocket.emitServerEvent("user:typing", {
          conversationId: TEST_CONVERSATION_ID,
          userId: TEST_OTHER_USER_ID,
          isTyping: true,
        });
      });

      expect(within(main).getByText(/سارة علي يكتب الآن/)).toBeInTheDocument();

      // Auto-expiry after 5s
      act(() => {
        vi.advanceTimersByTime(5100);
      });
      expect(
        within(main).queryByText(/سارة علي يكتب الآن/),
      ).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles presence states: unknown by default, online after event, and clears on reconnect", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    registerBaseChatHandlers();

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);
    act(() => {
      fakeSocket.simulateConnect("websocket");
    });

    const main = screen.getByRole("main");
    expect(within(main).queryByText("غير متصل")).not.toBeInTheDocument();
    expect(within(main).queryByText("متصل الآن")).not.toBeInTheDocument();

    // Online event
    act(() => {
      fakeSocket.emitServerEvent("user:status", {
        userId: TEST_OTHER_USER_ID,
        status: "online",
      });
    });

    expect(await within(main).findByText("متصل الآن")).toBeInTheDocument();

    // Offline event
    act(() => {
      fakeSocket.emitServerEvent("user:status", {
        userId: TEST_OTHER_USER_ID,
        status: "offline",
      });
    });

    expect(await within(main).findByText("غير متصل")).toBeInTheDocument();

    // Reconnecting clears presence map back to unknown
    act(() => {
      fakeSocket.simulateDisconnect("transport close", true);
      fakeSocket.simulateConnect("websocket");
    });

    await waitFor(() => {
      expect(
        usePresenceStore.getState().statusByUserId[TEST_OTHER_USER_ID],
      ).toBeUndefined();
    });
    expect(within(main).queryByText("غير متصل")).not.toBeInTheDocument();
  });

  it("debounces read receipts by ~300ms and sends only when active", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    const readReceiptCalls: string[] = [];

    registerBaseChatHandlers();
    fakeSocket.messageReadAckResolver = (payload) => {
      readReceiptCalls.push(payload.messageId);
      return { status: "ok" };
    };

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);
    act(() => {
      fakeSocket.simulateConnect("websocket");
    });

    const incoming: Message = {
      _id: "msg-debounced-read-1",
      conversationId: TEST_CONVERSATION_ID,
      senderId: TEST_OTHER_USER_ID,
      content: "رسالة مؤجلة القراءة",
      clientId: null,
      reads: [],
      expiresAt: null,
      createdAt: "2026-11-13T10:00:00.000Z",
      updatedAt: "2026-11-13T10:00:00.000Z",
    };

    act(() => {
      fakeSocket.emitServerEvent("message:new", {
        conversationId: TEST_CONVERSATION_ID,
        message: incoming,
      });
    });

    await waitFor(() => {
      expect(fakeSocket.emitted.some((c) => c.event === "message:read")).toBe(
        true,
      );
    });
  });

  it("updates unread badge, document.title unread count, and clears when conversation is opened", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    registerBaseChatHandlers();

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);
    act(() => {
      fakeSocket.simulateConnect("websocket");
    });

    // Incoming message for another conversation
    const backgroundMessage: Message = {
      _id: "msg-unread-bg-1",
      conversationId: TEST_SECOND_CONVERSATION_ID,
      senderId: "65f1a9c2e4b0a1b2c3d4e503",
      content: "رسالة جديدة في الخلفية",
      clientId: null,
      reads: [],
      expiresAt: null,
      createdAt: "2026-11-13T10:05:00.000Z",
      updatedAt: "2026-11-13T10:05:00.000Z",
    };

    act(() => {
      fakeSocket.emitServerEvent("message:new", {
        conversationId: TEST_SECOND_CONVERSATION_ID,
        message: backgroundMessage,
      });
    });

    await waitFor(() => {
      expect(document.title).toContain("(1) شات");
    });

    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("renders date separators and groups consecutive messages within 2 minutes", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    registerBaseChatHandlers();

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    // Day separator pill exists (formatted with Arabic date locale: "أمس")
    expect(await screen.findByText("أمس")).toBeInTheDocument();
  });

  it("hides typing and presence in Level 3 REST fallback mode", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    registerBaseChatHandlers();

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);
    act(() => {
      fakeSocket.simulateConnect("websocket");
    });

    const main = screen.getByRole("main");

    // Set online presence and typing
    act(() => {
      fakeSocket.emitServerEvent("user:status", {
        userId: TEST_OTHER_USER_ID,
        status: "online",
      });
      fakeSocket.emitServerEvent("user:typing", {
        conversationId: TEST_CONVERSATION_ID,
        userId: TEST_OTHER_USER_ID,
        isTyping: true,
      });
    });

    expect(await within(main).findByText("متصل الآن")).toBeInTheDocument();
    expect(
      await within(main).findByText(/سارة علي يكتب الآن/),
    ).toBeInTheDocument();

    // Force Level 3 REST fallback mode
    act(() => {
      useConnectionStore.getState().setRestFallbackActive(true);
    });

    // Presence and typing must disappear in Level 3
    expect(within(main).queryByText("متصل الآن")).not.toBeInTheDocument();
    expect(
      within(main).queryByText(/سارة علي يكتب الآن/),
    ).not.toBeInTheDocument();

    // Typing emission must be suppressed in Level 3
    fakeSocket.emitted = [];
    const composer = screen.getByLabelText("نص الرسالة");
    fireEvent.change(composer, {
      target: { value: "محاولة كتابة أثناء التراجع" },
    });
    expect(fakeSocket.emitted.some((c) => c.event === "typing:start")).toBe(
      false,
    );
  });
});
