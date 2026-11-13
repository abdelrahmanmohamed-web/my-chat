import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { useAuthStore, useConnectionStore, useOutboxStore } from "@/stores";
import type { Message } from "@/types/messages";
import { createFakeRealtimeSocket } from "./fake-socket";
import {
  TEST_CONVERSATION_ID,
  TEST_CONVERSATIONS,
  TEST_MESSAGES_NEWEST_FIRST,
  TEST_OTHER_USER_ID,
  TEST_USER,
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
  );
}

describe("Phase 4 resilience, fallback transport & outbox", () => {
  it("sends messages via WS timeout(8000) first and never calls REST POST on ok ack", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    let restPostCount = 0;

    fakeSocket.messageSendAckResolver = (payload) => ({
      status: "ok",
      data: {
        duplicate: false,
        message: {
          _id: "msg-ws-ack-1",
          conversationId: payload.conversationId,
          senderId: TEST_USER.id,
          content: payload.content,
          clientId: payload.clientId ?? null,
          reads: [],
          expiresAt: null,
          createdAt: "2026-11-12T12:20:00.000Z",
          updatedAt: "2026-11-12T12:20:00.000Z",
        },
      },
    });

    registerBaseChatHandlers();
    mswServer.use(
      http.post("*/api/conversations/:id/messages", () => {
        restPostCount += 1;
        return HttpResponse.json({ error: "unexpected" }, { status: 500 });
      }),
    );

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);
    act(() => {
      fakeSocket.simulateConnect("websocket");
    });

    fireEvent.change(screen.getByLabelText("نص الرسالة"), {
      target: { value: "رسالة عبر السوكت" },
    });
    fireEvent.click(screen.getByRole("button", { name: "إرسال الرسالة" }));

    expect(
      (await screen.findAllByText("رسالة عبر السوكت")).length,
    ).toBeGreaterThanOrEqual(1);
    await waitFor(() => {
      const wsSend = fakeSocket.emitted.find(
        (call) => call.event === "message:send",
      );
      expect(wsSend).toBeDefined();
      expect(wsSend?.timeoutMs).toBe(8000);
    });

    expect(restPostCount).toBe(0);
    expect(useOutboxStore.getState().items).toHaveLength(0);
  });

  it("marks failed with no REST fallback and no outbox retry on WS validation/forbidden ack error", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    let restPostCount = 0;

    fakeSocket.messageSendAckResolver = () => ({
      status: "error",
      error: "Forbidden: Not a participant",
    });

    registerBaseChatHandlers();
    mswServer.use(
      http.post("*/api/conversations/:id/messages", () => {
        restPostCount += 1;
        return HttpResponse.json({ error: "unexpected" }, { status: 500 });
      }),
    );

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);
    act(() => {
      fakeSocket.simulateConnect("websocket");
    });

    fireEvent.change(screen.getByLabelText("نص الرسالة"), {
      target: { value: "رسالة مرفوضة" },
    });
    fireEvent.click(screen.getByRole("button", { name: "إرسال الرسالة" }));

    expect(
      await screen.findByText("ليس لديك صلاحية لإرسال رسائل في هذه المحادثة."),
    ).toBeInTheDocument();
    expect(restPostCount).toBe(0);
    expect(useOutboxStore.getState().items).toHaveLength(0);
  });

  it("falls back to REST POST with the exact same clientId when WS send times out", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    const receivedClientIds: Array<string | undefined> = [];

    fakeSocket.messageSendAckResolver = () => "timeout";

    registerBaseChatHandlers();
    mswServer.use(
      http.post(
        "*/api/conversations/:id/messages",
        async ({ request, params }) => {
          const body = (await request.json()) as {
            content: string;
            clientId?: string;
          };
          receivedClientIds.push(body.clientId);

          const saved: Message = {
            _id: "msg-http-fallback-1",
            conversationId: String(params.id),
            senderId: TEST_USER.id,
            content: body.content,
            clientId: body.clientId ?? null,
            reads: [],
            expiresAt: null,
            createdAt: "2026-11-12T12:21:00.000Z",
            updatedAt: "2026-11-12T12:21:00.000Z",
          };
          return HttpResponse.json({ message: saved }, { status: 201 });
        },
      ),
    );

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);
    act(() => {
      fakeSocket.simulateConnect("websocket");
    });

    fireEvent.change(screen.getByLabelText("نص الرسالة"), {
      target: { value: "رسالة احتياطية" },
    });
    fireEvent.click(screen.getByRole("button", { name: "إرسال الرسالة" }));

    await waitFor(() => {
      expect(receivedClientIds).toHaveLength(1);
    });

    const wsCall = fakeSocket.emitted.find(
      (entry) => entry.event === "message:send",
    );
    const wsPayload = wsCall?.args[0] as { clientId?: string } | undefined;
    expect(wsPayload?.clientId).toBeTruthy();
    expect(receivedClientIds[0]).toBe(wsPayload?.clientId);

    // Late message:new for the same saved message must dedupe cleanly inside main timeline
    act(() => {
      fakeSocket.emitServerEvent("message:new", {
        conversationId: TEST_CONVERSATION_ID,
        message: {
          _id: "msg-http-fallback-1",
          conversationId: TEST_CONVERSATION_ID,
          senderId: TEST_USER.id,
          content: "رسالة احتياطية",
          clientId: wsPayload?.clientId ?? null,
          reads: [],
          expiresAt: null,
          createdAt: "2026-11-12T12:21:00.000Z",
          updatedAt: "2026-11-12T12:21:00.000Z",
        },
      });
    });

    const timeline = screen.getByRole("main");
    expect(timeline).toHaveTextContent("رسالة احتياطية");
    expect(
      Array.from(timeline.querySelectorAll("p")).filter((node) =>
        node.textContent?.includes("رسالة احتياطية"),
      ),
    ).toHaveLength(1);
    expect(useOutboxStore.getState().items).toHaveLength(0);
  });

  it("queues failed transient sends into outbox and flushes with original clientId on reconnect", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    let allowServer = false;
    const sentViaWsClientIds: string[] = [];

    fakeSocket.messageSendAckResolver = (payload) => {
      sentViaWsClientIds.push(payload.clientId ?? "");
      return {
        status: "ok",
        data: {
          duplicate: false,
          message: {
            _id: "msg-flushed-1",
            conversationId: payload.conversationId,
            senderId: TEST_USER.id,
            content: payload.content,
            clientId: payload.clientId ?? null,
            reads: [],
            expiresAt: null,
            createdAt: "2026-11-12T12:22:00.000Z",
            updatedAt: "2026-11-12T12:22:00.000Z",
          },
        },
      };
    };

    registerBaseChatHandlers();
    mswServer.use(
      http.post("*/api/conversations/:id/messages", () => {
        if (!allowServer) {
          return HttpResponse.json(
            {
              error: "Service unavailable",
              message: "الخدمة غير متاحة مؤقتاً",
            },
            { status: 503 },
          );
        }
        return HttpResponse.json({ error: "unexpected" }, { status: 500 });
      }),
    );

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);

    fireEvent.change(screen.getByLabelText("نص الرسالة"), {
      target: { value: "رسالة محفوظة مؤقتاً" },
    });
    fireEvent.click(screen.getByRole("button", { name: "إرسال الرسالة" }));

    expect(
      await screen.findByRole("button", { name: "إعادة المحاولة" }),
    ).toBeInTheDocument();

    const queuedClientId = useOutboxStore.getState().items[0]?.clientId;
    expect(useOutboxStore.getState().items).toHaveLength(1);
    expect(queuedClientId).toBeTruthy();

    allowServer = true;
    act(() => {
      fakeSocket.simulateConnect("websocket");
    });

    await waitFor(() => {
      expect(useOutboxStore.getState().items).toHaveLength(0);
    });
    expect(sentViaWsClientIds).toEqual([queuedClientId]);
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "إعادة المحاولة" }),
      ).not.toBeInTheDocument();
    });
  });

  it("does not enqueue 4xx HTTP errors into outbox", async () => {
    const fakeSocket = createFakeRealtimeSocket();

    registerBaseChatHandlers();
    mswServer.use(
      http.post("*/api/conversations/:id/messages", () =>
        HttpResponse.json(
          { error: "ValidationError", message: "النص غير صالح" },
          { status: 400 },
        ),
      ),
    );

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);
    fireEvent.change(screen.getByLabelText("نص الرسالة"), {
      target: { value: "رسالة مرفوضة 400" },
    });
    fireEvent.click(screen.getByRole("button", { name: "إرسال الرسالة" }));

    expect(
      await screen.findByRole("button", { name: "إعادة المحاولة" }),
    ).toBeInTheDocument();
    expect(useOutboxStore.getState().items).toHaveLength(0);
  });

  it("tries WS message:read first and falls back to REST PATCH on timeout", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    const patchedMessageIds: string[] = [];

    fakeSocket.messageReadAckResolver = () => "timeout";

    registerBaseChatHandlers();
    mswServer.use(
      http.patch(
        "*/api/conversations/:id/messages/:messageId/read",
        ({ params }) => {
          patchedMessageIds.push(String(params.messageId));
          return HttpResponse.json({ status: "ok" });
        },
      ),
    );

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);
    act(() => {
      fakeSocket.simulateConnect("websocket");
    });

    act(() => {
      fakeSocket.emitServerEvent("message:new", {
        conversationId: TEST_CONVERSATION_ID,
        message: {
          _id: "msg-incoming-read-fallback",
          conversationId: TEST_CONVERSATION_ID,
          senderId: TEST_OTHER_USER_ID,
          content: "رسالة للقراءة",
          clientId: null,
          reads: [],
          expiresAt: null,
          createdAt: "2026-11-12T12:23:00.000Z",
          updatedAt: "2026-11-12T12:23:00.000Z",
        },
      });
    });

    await waitFor(() => {
      expect(
        fakeSocket.emitted.some(
          (call) => call.event === "message:read" && call.timeoutMs === 5000,
        ),
      ).toBe(true);
    });

    await waitFor(() => {
      expect(patchedMessageIds).toContain("msg-incoming-read-fallback");
    });
  });

  it("refreshes session once on expired-token connect_error and reconnects; logs out when session is revoked", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    let refreshCount = 0;

    registerBaseChatHandlers();
    mswServer.use(
      http.post("*/api/auth/refresh", () => {
        refreshCount += 1;
        if (refreshCount <= 2) {
          return HttpResponse.json({
            accessToken: "refreshed-socket-token",
            user: TEST_USER,
          });
        }
        return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
      }),
    );

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);
    const refreshesAfterBoot = refreshCount;
    const initialConnectCalls = fakeSocket.connectCalls;

    act(() => {
      fakeSocket.simulateConnectError(
        "Unauthorized: Invalid or expired token",
        false,
      );
    });

    await waitFor(() => {
      expect(refreshCount).toBe(refreshesAfterBoot + 1);
      expect(fakeSocket.connectCalls).toBe(initialConnectCalls + 1);
    });
    expect(useAuthStore.getState().accessToken).toBe("refreshed-socket-token");

    act(() => {
      fakeSocket.simulateConnect("websocket");
    });

    useOutboxStore.getState().enqueue({
      clientId: "queued-before-revoke",
      conversationId: TEST_CONVERSATION_ID,
      content: "لن تبقى بعد الخروج",
      createdAt: "2026-11-12T12:24:00.000Z",
    });

    act(() => {
      fakeSocket.simulateConnectError(
        "Unauthorized: Session is invalid or revoked",
        false,
      );
    });

    expect(
      await screen.findByRole("button", { name: "دخول" }),
    ).toBeInTheDocument();
    expect(useAuthStore.getState().status).toBe("unauthenticated");
    expect(useOutboxStore.getState().items).toHaveLength(0);
    expect(fakeSocket.disconnectCalls).toBeGreaterThanOrEqual(1);
  });

  it("logs out when Missing authorization header occurs on socket connect_error", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    registerBaseChatHandlers();

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);

    act(() => {
      fakeSocket.simulateConnectError(
        "Unauthorized: Missing authorization header",
        false,
      );
    });

    expect(
      await screen.findByRole("button", { name: "دخول" }),
    ).toBeInTheDocument();
    expect(useAuthStore.getState().status).toBe("unauthenticated");
  });

  it("activates Level 3 REST banner on offline/online transition and recovers cleanly on connect", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    let conversationsFetchCount = 0;

    mswServer.use(
      http.get("*/api/conversations", () => {
        conversationsFetchCount += 1;
        return HttpResponse.json({ conversations: TEST_CONVERSATIONS });
      }),
      http.get("*/api/conversations/:conversationId/messages", () =>
        HttpResponse.json({
          messages: TEST_MESSAGES_NEWEST_FIRST,
          nextCursor: null,
        }),
      ),
    );

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);
    act(() => {
      fakeSocket.simulateConnect("websocket");
    });
    expect(await screen.findByText("متصل مباشر")).toBeInTheDocument();

    act(() => {
      fakeSocket.simulateDisconnect("transport close", false);
      fireEvent(window, new Event("offline"));
    });

    expect(
      await screen.findByText(
        "لا يوجد اتصال بالإنترنت. ستُحفظ الرسائل الجديدة وتُرسل تلقائياً عند عودة الشبكة.",
      ),
    ).toBeInTheDocument();
    expect(useConnectionStore.getState().isRestFallbackActive).toBe(true);

    const connectCallsBeforeOnline = fakeSocket.connectCalls;
    act(() => {
      fireEvent(window, new Event("online"));
    });

    await waitFor(() => {
      expect(fakeSocket.connectCalls).toBe(connectCallsBeforeOnline + 1);
    });
    expect(
      await screen.findByText(
        "الاتصال المباشر غير متاح حالياً. يعمل التحديث التلقائي عبر (REST) في الخلفية.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "إعادة المحاولة الآن" }),
    );
    expect(fakeSocket.connectCalls).toBe(connectCallsBeforeOnline + 2);

    const fetchesBeforeConnect = conversationsFetchCount;
    act(() => {
      fakeSocket.simulateConnect("websocket");
    });

    await waitFor(() => {
      expect(useConnectionStore.getState().isRestFallbackActive).toBe(false);
    });
    await waitFor(() => {
      expect(conversationsFetchCount).toBeGreaterThan(fetchesBeforeConnect);
    });
    expect(
      screen.queryByText(
        "الاتصال المباشر غير متاح حالياً. يعمل التحديث التلقائي عبر (REST) في الخلفية.",
      ),
    ).not.toBeInTheDocument();
  });

  it("activates Level 3 banner after ~5s grace delay when socket stays down while online", async () => {
    const fakeSocket = createFakeRealtimeSocket();
    registerBaseChatHandlers();

    renderAppAt(`/conversations/${TEST_CONVERSATION_ID}`, {
      socketInstance: fakeSocket,
    });

    await screen.findByText(/السلام عليكم/);
    act(() => {
      fakeSocket.simulateConnect("websocket");
    });
    expect(await screen.findByText("متصل مباشر")).toBeInTheDocument();

    vi.useFakeTimers();
    try {
      act(() => {
        fakeSocket.simulateDisconnect("transport close", true);
      });

      expect(useConnectionStore.getState().isRestFallbackActive).toBe(false);

      act(() => {
        vi.advanceTimersByTime(4900);
      });
      expect(useConnectionStore.getState().isRestFallbackActive).toBe(false);

      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(useConnectionStore.getState().isRestFallbackActive).toBe(true);
    } finally {
      vi.useRealTimers();
    }

    expect(
      await screen.findByRole("button", { name: "إعادة المحاولة الآن" }),
    ).toBeInTheDocument();
  });
});
