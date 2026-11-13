import type {
  RealtimeEngineLike,
  RealtimeListenEventMap,
  RealtimeManagerLike,
  RealtimeSocket,
  RealtimeTimeoutSocket,
} from "@/lib/socket";
import type { Message } from "@/types/messages";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
  SocketAck,
} from "@/types/socket";

type ListenEvent = keyof RealtimeListenEventMap;

type StoredListener =
  | (() => void)
  | ((reason: string) => void)
  | ((error: Error) => void)
  | ServerToClientEvents[keyof ServerToClientEvents];

export interface EmittedSocketCall {
  event: keyof ClientToServerEvents;
  args: unknown[];
  timeoutMs?: number;
}

export class FakeRealtimeSocket implements RealtimeSocket {
  connected = false;
  active = false;
  connectCalls = 0;
  disconnectCalls = 0;
  emitted: EmittedSocketCall[] = [];
  joinAckResolver?: (
    conversationId: string,
  ) => SocketAck<{ conversationId: string }>;
  messageSendAckResolver?: (payload: {
    conversationId: string;
    content: string;
    clientId?: string;
  }) => SocketAck<{ message: Message; duplicate: boolean }> | "timeout";
  messageReadAckResolver?: (payload: {
    conversationId: string;
    messageId: string;
  }) => SocketAck<{ status: "ok" }> | "timeout";

  private listeners = new Map<ListenEvent, Set<StoredListener>>();
  private managerListeners = new Set<(attempt: number) => void>();
  private engineUpgradeListeners = new Set<
    (transport: { name: string }) => void
  >();

  readonly io: RealtimeManagerLike;

  constructor() {
    const engine: RealtimeEngineLike = {
      transport: { name: "websocket" },
      on: (_event, listener) => {
        this.engineUpgradeListeners.add(listener);
        return engine;
      },
      off: (_event, listener) => {
        this.engineUpgradeListeners.delete(listener);
        return engine;
      },
    };

    this.io = {
      engine,
      on: (_event, listener) => {
        this.managerListeners.add(listener);
        return this.io;
      },
      off: (_event, listener) => {
        this.managerListeners.delete(listener);
        return this.io;
      },
    };
  }

  connect(): this {
    this.connectCalls += 1;
    this.active = true;
    return this;
  }

  disconnect(): this {
    this.disconnectCalls += 1;
    this.connected = false;
    this.active = false;
    return this;
  }

  timeout(timeoutMs: number): RealtimeTimeoutSocket {
    const emitWithTimeout = ((
      event: "message:send" | "message:read",
      payload:
        | { conversationId: string; content: string; clientId?: string }
        | { conversationId: string; messageId: string },
      ack: (err: Error | null, response?: unknown) => void,
    ) => {
      this.emitted.push({ event, args: [payload, ack], timeoutMs });

      if (event === "message:send") {
        const sendPayload = payload as {
          conversationId: string;
          content: string;
          clientId?: string;
        };
        const result = this.messageSendAckResolver
          ? this.messageSendAckResolver(sendPayload)
          : "timeout";
        if (result === "timeout") {
          ack(new Error("operation has timed out"));
        } else {
          ack(null, result);
        }
        return this;
      }

      const readPayload = payload as {
        conversationId: string;
        messageId: string;
      };
      const result = this.messageReadAckResolver
        ? this.messageReadAckResolver(readPayload)
        : { status: "ok" as const, data: { status: "ok" as const } };
      if (result === "timeout") {
        ack(new Error("operation has timed out"));
      } else {
        ack(null, result);
      }
      return this;
    }) as RealtimeTimeoutSocket["emit"];

    return { emit: emitWithTimeout };
  }

  on<E extends ListenEvent>(
    event: E,
    listener: RealtimeListenEventMap[E],
  ): this {
    const set = this.listeners.get(event) ?? new Set<StoredListener>();
    set.add(listener);
    this.listeners.set(event, set);
    return this;
  }

  off<E extends ListenEvent>(
    event: E,
    listener: RealtimeListenEventMap[E],
  ): this {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  emit<E extends keyof ClientToServerEvents>(
    event: E,
    ...args: Parameters<ClientToServerEvents[E]>
  ): this {
    this.emitted.push({ event, args: [...args] });

    if (event === "join:conversation") {
      const [conversationId, ack] = args as Parameters<
        ClientToServerEvents["join:conversation"]
      >;
      if (ack) {
        const result = this.joinAckResolver
          ? this.joinAckResolver(conversationId)
          : { status: "ok" as const, data: { conversationId } };
        ack(result);
      }
    }

    if (event === "message:send") {
      const [payload, ack] = args as Parameters<
        ClientToServerEvents["message:send"]
      >;
      if (ack && this.messageSendAckResolver) {
        const result = this.messageSendAckResolver(payload);
        if (result !== "timeout") {
          ack(result);
        }
      }
    }

    if (event === "message:read") {
      const [payload, ack] = args as Parameters<
        ClientToServerEvents["message:read"]
      >;
      if (ack && this.messageReadAckResolver) {
        const result = this.messageReadAckResolver(payload);
        if (result !== "timeout") {
          ack(result);
        }
      }
    }

    return this;
  }

  simulateConnect(transport: "websocket" | "polling" = "websocket"): void {
    this.connected = true;
    this.active = true;
    if (this.io.engine) {
      this.io.engine.transport = { name: transport };
    }
    this.dispatch("connect");
  }

  simulateUpgrade(transport: "websocket" | "polling"): void {
    if (this.io.engine) {
      this.io.engine.transport = { name: transport };
    }
    for (const listener of [...this.engineUpgradeListeners]) {
      listener({ name: transport });
    }
  }

  simulateDisconnect(
    reason: string,
    keepActive = reason !== "io server disconnect",
  ): void {
    this.connected = false;
    this.active = keepActive;
    this.dispatch("disconnect", reason);
  }

  simulateReconnectAttempt(attempt = 1): void {
    for (const listener of [...this.managerListeners]) {
      listener(attempt);
    }
  }

  simulateConnectError(message: string, active = true): void {
    this.connected = false;
    this.active = active;
    this.dispatch("connect_error", new Error(message));
  }

  emitServerEvent<E extends keyof ServerToClientEvents>(
    event: E,
    ...args: Parameters<ServerToClientEvents[E]>
  ): void {
    this.dispatch(event, ...args);
  }

  listenerCount(event: ListenEvent): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  engineUpgradeListenerCount(): number {
    return this.engineUpgradeListeners.size;
  }

  private dispatch(event: ListenEvent, ...args: unknown[]): void {
    const registered = this.listeners.get(event);
    if (!registered) {
      return;
    }

    for (const listener of [...registered]) {
      (listener as (...cbArgs: unknown[]) => void)(...args);
    }
  }
}

export function createFakeRealtimeSocket(): FakeRealtimeSocket {
  return new FakeRealtimeSocket();
}
