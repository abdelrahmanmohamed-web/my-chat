/**
 * ============================================================================
 * OpenAPI 3.0.3 Specification Generator & Validator
 * ============================================================================
 * Introspects the live Express 5 router tree, converts existing Zod validation
 * schemas via Zod v4's OpenAPI 3.0 JSON Schema target, combines them with
 * controller/service-verified response contracts, validates completeness and
 * referential integrity, and writes docs/openapi.yaml.
 *
 * Usage:
 *   npm run generate:openapi
 *   npx tsx scripts/generate-openapi.ts --check
 * ============================================================================
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Express, RequestHandler } from "express";
import { z } from "zod";

import {
  changePasswordSchema,
  credentialsSchema,
  registerSchema,
  updateSessionNameSchema,
} from "../src/modules/auth/auth.schemas.ts";
import {
  conversationUpdateSchema,
  directConversationSchema,
} from "../src/modules/conversations/conversation.schemas.ts";
import {
  listMessagesQuerySchema,
  sendMessageSchema,
} from "../src/modules/messages/message.schemas.ts";

// ============================================================================
// Types
// ============================================================================

type HttpMethod = "get" | "post" | "put" | "patch" | "delete";
type RateLimiterId = "global" | "register" | "login" | "refresh";

type JsonObject = Record<string, unknown>;

interface DiscoveredRoute {
  method: HttpMethod;
  expressPath: string;
  openApiPath: string;
  requiresAuth: boolean;
  rateLimiters: RateLimiterId[];
}

interface SecurityRequirement {
  [schemeName: string]: string[];
}

interface ParameterMetadata {
  name: string;
  in: "path" | "query";
  required: boolean;
  description: string;
  schema: JsonObject;
}

interface RequestBodyMetadata {
  required: boolean;
  description: string;
  schemaRef?: string;
  schema?: JsonObject;
}

interface EndpointMetadata {
  operationId: string;
  tags: string[];
  summary: string;
  description: string;
  /** Overrides default `requireAuth`-derived security when an endpoint accepts cookie/body/optional auth. */
  securityOverride?: SecurityRequirement[];
  pathParameters?: ParameterMetadata[];
  queryZodSchema?: z.ZodObject<z.ZodRawShape>;
  queryParameterOverrides?: Record<string, Partial<ParameterMetadata>>;
  extraQueryParameters?: ParameterMetadata[];
  requestBody?: RequestBodyMetadata;
  responses: Record<string, JsonObject>;
}

// ============================================================================
// Constants & Paths
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BACKEND_ROOT = path.resolve(__dirname, "..");
const ROOT_PACKAGE_JSON_PATH = path.resolve(BACKEND_ROOT, "..", "package.json");
const BACKEND_PACKAGE_JSON_PATH = path.join(BACKEND_ROOT, "package.json");
const OUTPUT_PATH = path.join(BACKEND_ROOT, "docs", "openapi.yaml");

const HTTP_METHODS = new Set<HttpMethod>([
  "get",
  "post",
  "put",
  "patch",
  "delete",
]);

const OBJECT_ID_PATTERN = "^[0-9a-fA-F]{24}$";

// ============================================================================
// Express 5 Live Router Introspection
// ============================================================================

interface ExpressLayer {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: Array<{ handle: RequestHandler }>;
  };
  handle: RequestHandler & { stack?: ExpressLayer[] };
}

type ExpressRouterWithStack = {
  stack: ExpressLayer[];
};

function getAppRouterStack(app: Express): ExpressLayer[] {
  return (app.router as unknown as ExpressRouterWithStack).stack;
}

function ensureGeneratorEnv(): void {
  // src/config/env.ts validates required runtime variables at import time.
  // Provide safe placeholders only when absent so generation works without .env.secrets.
  process.env.MONGODB_URI ??= "mongodb://127.0.0.1:27017/openapi_generator";
  process.env.ACCESS_TOKEN_SECRET ??=
    "openapi-generator-placeholder-access-secret-32b";
  process.env.REFRESH_TOKEN_SECRET ??=
    "openapi-generator-placeholder-refresh-secret-32";
}

function joinExpressPaths(base: string, segment: string): string {
  const combined =
    `${base.replace(/\/+$/, "")}/${segment.replace(/^\/+/, "")}`.replace(
      /\/+/g,
      "/",
    );
  return combined.length > 1 ? combined.replace(/\/+$/, "") : "/";
}

function expressPathToOpenApi(expressPath: string): string {
  return expressPath.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function mountPathApplies(
  middlewareMount: string,
  targetMount: string,
): boolean {
  if (middlewareMount === "/" || middlewareMount === targetMount) return true;
  const normalizedMw = middlewareMount.replace(/\/+$/, "");
  return targetMount.startsWith(`${normalizedMw}/`);
}

async function discoverExpressRoutes(): Promise<DiscoveredRoute[]> {
  ensureGeneratorEnv();

  const { default: express } = await import("express");
  const { default: pino } = await import("pino");

  const routerProto = express.Router.prototype as {
    use: (...args: unknown[]) => unknown;
  };
  const originalUse = routerProto.use;
  const layerMountPaths = new WeakMap<ExpressLayer, string>();

  // Express 5 compiles mount strings into matchers and leaves layer.path undefined.
  // Intercept Router.prototype.use briefly while constructing the app to retain mount prefixes.
  routerProto.use = function patchedUse(
    this: { stack: ExpressLayer[] },
    ...args: unknown[]
  ) {
    const first = args[0];
    const mountPath = typeof first === "string" ? first : "/";
    const beforeLen = this.stack.length;
    const result = originalUse.apply(this, args);
    for (let i = beforeLen; i < this.stack.length; i += 1) {
      layerMountPaths.set(this.stack[i], mountPath);
    }
    return result;
  };

  let app: Express;
  let requireAuthFn: RequestHandler;
  let rateLimiters: {
    globalApiRateLimiter: RequestHandler;
    registerRateLimiter: RequestHandler;
    loginRateLimiter: RequestHandler;
    refreshRateLimiter: RequestHandler;
  };

  try {
    const [{ createApp }, authMiddleware, limiters] = await Promise.all([
      import("../src/app.ts"),
      import("../src/modules/auth/auth.middleware.ts"),
      import("../src/shared/middleware/rate.limit.ts"),
    ]);

    app = createApp(pino({ level: "silent" }));
    requireAuthFn = authMiddleware.requireAuth;
    rateLimiters = limiters;
  } finally {
    routerProto.use = originalUse;
  }

  const limiterMap = new Map<RequestHandler, RateLimiterId>([
    [rateLimiters.globalApiRateLimiter, "global"],
    [rateLimiters.registerRateLimiter, "register"],
    [rateLimiters.loginRateLimiter, "login"],
    [rateLimiters.refreshRateLimiter, "refresh"],
  ]);

  const discovered: DiscoveredRoute[] = [];

  function walkStack(
    stack: ExpressLayer[],
    prefix: string,
    inheritedMiddleware: RequestHandler[],
  ): void {
    const scopedMiddleware: Array<{ mount: string; fn: RequestHandler }> = [];

    for (const layer of stack) {
      if (layer.route) {
        const expressPath = joinExpressPaths(prefix, layer.route.path);
        const routeMiddleware = layer.route.stack.map((s) => s.handle);
        const activeMiddleware = [
          ...inheritedMiddleware,
          ...scopedMiddleware
            .filter((entry) => mountPathApplies(entry.mount, layer.route!.path))
            .map((entry) => entry.fn),
          ...routeMiddleware,
        ];

        const requiresAuth = activeMiddleware.includes(requireAuthFn);
        const activeLimiters = Array.from(
          new Set(
            activeMiddleware
              .map((fn) => limiterMap.get(fn))
              .filter((id): id is RateLimiterId => id !== undefined),
          ),
        );

        for (const [rawMethod, enabled] of Object.entries(
          layer.route.methods,
        )) {
          const method = rawMethod.toLowerCase() as HttpMethod;
          if (!enabled || !HTTP_METHODS.has(method)) continue;

          discovered.push({
            method,
            expressPath,
            openApiPath: expressPathToOpenApi(expressPath),
            requiresAuth,
            rateLimiters: activeLimiters,
          });
        }
      } else if (Array.isArray(layer.handle?.stack)) {
        const mountPath = layerMountPaths.get(layer) ?? "/";
        const subPrefix = joinExpressPaths(prefix, mountPath);
        const matchingMiddleware = scopedMiddleware
          .filter((entry) => mountPathApplies(entry.mount, mountPath))
          .map((entry) => entry.fn);

        walkStack(layer.handle.stack, subPrefix, [
          ...inheritedMiddleware,
          ...matchingMiddleware,
        ]);
      } else {
        const mountPath = layerMountPaths.get(layer) ?? "/";
        scopedMiddleware.push({ mount: mountPath, fn: layer.handle });
      }
    }
  }

  walkStack(getAppRouterStack(app), "", []);
  return discovered;
}

// ============================================================================
// Zod Schema Conversion (OpenAPI 3.0.3)
// ============================================================================

function convertZodToOpenApiSchema(
  schema: z.ZodTypeAny,
  enrich?: (converted: JsonObject) => JsonObject,
): JsonObject {
  const jsonSchema = z.toJSONSchema(schema, {
    target: "openapi-3.0",
    io: "input",
  }) as JsonObject;

  // Strip JSON Schema dialect keyword if present (disallowed in OpenAPI 3.0.3 Schema Object)
  delete jsonSchema.$schema;

  return enrich ? enrich(jsonSchema) : jsonSchema;
}

function buildZodComponentSchemas(): Record<string, JsonObject> {
  return {
    RegisterRequest: convertZodToOpenApiSchema(registerSchema, (s) => {
      const props = s.properties as Record<string, JsonObject>;
      props.email.description =
        "User email address (trimmed and stored lowercased).";
      props.username.description =
        "Unique username containing letters, numbers, and underscores (trimmed; lowercased on persistence).";
      props.displayName.description =
        "Public display name shown in chats (trimmed).";
      props.password.format = "password";
      props.password.description = "Plaintext password (6-128 characters).";
      return s;
    }),

    LoginRequest: convertZodToOpenApiSchema(credentialsSchema, (s) => {
      const props = s.properties as Record<string, JsonObject>;
      props.email.description = "Registered email address (trimmed).";
      props.password.format = "password";
      props.password.description = "Account password.";
      props.device.description =
        "Optional client device label (trimmed). Defaults to value inferred from User-Agent header.";
      props.name.description =
        "Optional friendly session name (trimmed). Defaults to value inferred from User-Agent header.";
      props.revokeSessionId.description =
        "Optional session revocation target when resolving max-session limits: 'all' revokes all active sessions; a 24-character hex ObjectId revokes that specific session; other values are ignored.";
      return s;
    }),

    ChangePasswordRequest: convertZodToOpenApiSchema(
      changePasswordSchema,
      (s) => {
        const props = s.properties as Record<string, JsonObject>;
        props.currentPassword.format = "password";
        props.currentPassword.description = "User's existing password.";
        props.newPassword.format = "password";
        props.newPassword.description =
          "Replacement password (6-128 characters).";
        return s;
      },
    ),

    UpdateSessionNameRequest: convertZodToOpenApiSchema(
      updateSessionNameSchema,
      (s) => {
        const props = s.properties as Record<string, JsonObject>;
        props.name.description = "New user-friendly session label (trimmed).";
        return s;
      },
    ),

    DirectConversationRequest: convertZodToOpenApiSchema(
      directConversationSchema,
      (s) => {
        const props = s.properties as Record<string, JsonObject>;
        props.participantId.description =
          "Target user's MongoDB ObjectId (24-character hex string, trimmed). Must refer to an existing user other than the caller.";
        return s;
      },
    ),

    ConversationUpdateRequest: convertZodToOpenApiSchema(
      conversationUpdateSchema,
      (s) => {
        const props = s.properties as Record<string, JsonObject>;
        props.name.description =
          "Custom conversation display name (trimmed). Pass null to clear the custom name and restore the counterpart's displayName.";
        props.avatarUrl.description =
          "Conversation avatar URL (trimmed). Pass null to clear.";

        // Preserve Zod .refine(v => v.name !== undefined || v.avatarUrl !== undefined)
        return {
          ...s,
          description:
            "At least one of `name` or `avatarUrl` must be provided in the request body.",
          anyOf: [
            { type: "object", required: ["name"] },
            { type: "object", required: ["avatarUrl"] },
          ],
          "x-zod-refine": "At least one conversation property is required",
        };
      },
    ),

    SendMessageRequest: convertZodToOpenApiSchema(sendMessageSchema, (s) => {
      const props = s.properties as Record<string, JsonObject>;
      props.content.description =
        "Message text content (trimmed, 1-4000 characters).";
      props.clientId.description =
        "Optional client-generated idempotency key (trimmed, 1-100 characters). Reusing the same clientId for the same sender returns the existing message with HTTP 200.";
      return s;
    }),
  };
}

// ============================================================================
// Reusable OpenAPI Components (Responses, Schemas, Headers, Security)
// ============================================================================

function buildReusableComponents(): JsonObject {
  const zodSchemas = buildZodComponentSchemas();

  return {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "HS256 JWT access token issued by POST /api/auth/login or POST /api/auth/refresh. Validated by requireAuth middleware against signature, issuer, audience, and active MongoDB Session.activeAccessTokenId.",
      },
      refreshCookie: {
        type: "apiKey",
        in: "cookie",
        name: "refreshToken",
        description:
          "HS256 JWT refresh token stored in an HttpOnly, SameSite=Lax cookie scoped to Path=/api/auth (Secure in production). Set on login/refresh and cleared on logout or failed refresh.",
      },
    },

    headers: {
      SetRefreshCookie: {
        description:
          "Sets the HttpOnly refreshToken cookie (Path=/api/auth, SameSite=Lax, Max-Age=REFRESH_TTL_SECONDS, Secure in production).",
        schema: {
          type: "string",
          example:
            "refreshToken=eyJhbGciOiJIUzI1NiJ9...; Max-Age=1209600; Path=/api/auth; HttpOnly; SameSite=Lax",
        },
      },
      ClearRefreshCookie: {
        description:
          "Clears the refreshToken cookie (Path=/api/auth, HttpOnly, SameSite=Lax, Secure in production).",
        schema: {
          type: "string",
          example:
            "refreshToken=; Path=/api/auth; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax",
        },
      },
      RateLimit: {
        description:
          "IETF draft-8 RateLimit header emitted by express-rate-limit.",
        schema: { type: "string" },
      },
      RateLimitPolicy: {
        description:
          "IETF draft-8 RateLimit-Policy header emitted by express-rate-limit.",
        schema: { type: "string" },
      },
    },

    schemas: {
      ...zodSchemas,

      RefreshTokenBodyRequest: {
        type: "object",
        description:
          "Optional fallback payload when the refreshToken HttpOnly cookie is not sent (cookie takes precedence).",
        properties: {
          refreshToken: {
            type: "string",
            description: "Raw JWT refresh token string.",
          },
        },
      },

      ErrorResponse: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "string",
            description: "Human-readable error summary or machine error code.",
          },
        },
      },

      ValidationErrorResponse: {
        type: "object",
        required: ["error", "details"],
        properties: {
          error: {
            type: "string",
            example: "Validation failed",
          },
          details: {
            type: "object",
            required: ["formErrors", "fieldErrors"],
            properties: {
              formErrors: {
                type: "array",
                items: { type: "string" },
              },
              fieldErrors: {
                type: "object",
                additionalProperties: {
                  type: "array",
                  items: { type: "string" },
                },
              },
            },
          },
        },
      },

      PublicUser: {
        type: "object",
        required: ["id", "email", "username", "displayName"],
        description:
          "Sanitized public user representation returned by toPublicUser (excludes passwordHash and internal fields).",
        properties: {
          id: { type: "string", pattern: OBJECT_ID_PATTERN },
          email: { type: "string", format: "email" },
          username: { type: "string" },
          displayName: { type: "string" },
          avatarUrl: { type: "string", nullable: true },
        },
      },

      UserResponse: {
        type: "object",
        required: ["user"],
        properties: {
          user: { $ref: "#/components/schemas/PublicUser" },
        },
      },

      SanitizedSession: {
        type: "object",
        required: [
          "id",
          "name",
          "device",
          "ip",
          "userAgent",
          "createdAt",
          "lastActiveAt",
          "current",
        ],
        description:
          "Sanitized session view (excludes refreshTokenHash and activeAccessTokenId).",
        properties: {
          id: { type: "string", pattern: OBJECT_ID_PATTERN },
          name: { type: "string" },
          device: { type: "string" },
          ip: { type: "string" },
          userAgent: { type: "string" },
          createdAt: { type: "string", format: "date-time" },
          lastActiveAt: { type: "string", format: "date-time" },
          current: { type: "boolean" },
        },
      },

      LoginSuccessResponse: {
        type: "object",
        required: ["accessToken", "tokenType", "expiresIn", "user"],
        properties: {
          accessToken: { type: "string" },
          tokenType: { type: "string", enum: ["Bearer"], example: "Bearer" },
          expiresIn: {
            type: "integer",
            description: "Access token lifetime in seconds (default 840).",
            example: 840,
          },
          user: { $ref: "#/components/schemas/PublicUser" },
        },
      },

      RefreshSuccessResponse: {
        type: "object",
        required: ["accessToken", "tokenType", "expiresIn"],
        properties: {
          accessToken: { type: "string" },
          tokenType: { type: "string", enum: ["Bearer"], example: "Bearer" },
          expiresIn: {
            type: "integer",
            description: "Access token lifetime in seconds (default 840).",
            example: 840,
          },
        },
      },

      MaxSessionsReachedResponse: {
        type: "object",
        required: ["error", "message", "sessions"],
        properties: {
          error: {
            type: "string",
            enum: ["MAX_SESSIONS_REACHED"],
            example: "MAX_SESSIONS_REACHED",
          },
          message: {
            type: "string",
            example:
              "Maximum active sessions reached. Please select a session to terminate.",
          },
          sessions: {
            type: "array",
            items: { $ref: "#/components/schemas/SanitizedSession" },
          },
        },
      },

      ConversationLastMessage: {
        type: "object",
        properties: {
          messageId: { type: "string", pattern: OBJECT_ID_PATTERN },
          senderId: { type: "string", pattern: OBJECT_ID_PATTERN },
          content: { type: "string", maxLength: 200 },
        },
      },

      Conversation: {
        type: "object",
        required: [
          "_id",
          "type",
          "participantIds",
          "hiddenFor",
          "name",
          "avatarUrl",
          "lastMessageAt",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          _id: { type: "string", pattern: OBJECT_ID_PATTERN },
          type: { type: "string", enum: ["direct"] },
          directKey: {
            type: "string",
            description:
              "Sorted pair key '<minObjectId>:<maxObjectId>' present on direct conversations.",
          },
          participantIds: {
            type: "array",
            items: { type: "string", pattern: OBJECT_ID_PATTERN },
          },
          hiddenFor: {
            type: "array",
            items: { type: "string", pattern: OBJECT_ID_PATTERN },
          },
          name: {
            type: "string",
            nullable: true,
            description:
              "Custom conversation name, or dynamically resolved counterpart displayName for direct conversations when unset.",
          },
          avatarUrl: { type: "string", nullable: true },
          lastMessageAt: {
            type: "string",
            format: "date-time",
            nullable: true,
          },
          lastMessage: {
            $ref: "#/components/schemas/ConversationLastMessage",
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          __v: { type: "integer" },
        },
      },

      MessageRead: {
        type: "object",
        properties: {
          _id: { type: "string", pattern: OBJECT_ID_PATTERN },
          userId: { type: "string", pattern: OBJECT_ID_PATTERN },
          lastReadMessageId: { type: "string", pattern: OBJECT_ID_PATTERN },
        },
      },

      Message: {
        type: "object",
        required: [
          "_id",
          "conversationId",
          "senderId",
          "content",
          "clientId",
          "reads",
          "expiresAt",
          "createdAt",
          "updatedAt",
        ],
        properties: {
          _id: { type: "string", pattern: OBJECT_ID_PATTERN },
          conversationId: { type: "string", pattern: OBJECT_ID_PATTERN },
          senderId: { type: "string", pattern: OBJECT_ID_PATTERN },
          content: { type: "string" },
          clientId: { type: "string", nullable: true },
          reads: {
            type: "array",
            items: { $ref: "#/components/schemas/MessageRead" },
          },
          expiresAt: {
            type: "string",
            format: "date-time",
            nullable: true,
          },
          createdAt: { type: "string", format: "date-time" },
          updatedAt: { type: "string", format: "date-time" },
          __v: { type: "integer" },
        },
      },

      ConversationResponse: {
        type: "object",
        required: ["conversation"],
        properties: {
          conversation: { $ref: "#/components/schemas/Conversation" },
        },
      },

      MessageResponse: {
        type: "object",
        required: ["message"],
        properties: {
          message: { $ref: "#/components/schemas/Message" },
        },
      },
    },

    responses: {
      Unauthorized: {
        description:
          "Missing, invalid, expired, or revoked Bearer access token.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            example: { error: "Unauthorized" },
          },
        },
      },
      ConversationForbidden: {
        description:
          "Authenticated user is not a participant in the conversation.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            example: { error: "Forbidden" },
          },
        },
      },
      SessionNotFound: {
        description:
          "Session not found, not owned by caller, or invalid ObjectId.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            example: { error: "Session not found" },
          },
        },
      },
      ConversationNotFound: {
        description:
          "Conversation not found, caller is not a participant, or invalid ObjectId.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            example: { error: "Conversation not found" },
          },
        },
      },
      PayloadTooLarge: {
        description:
          "JSON request body exceeded the 16kb limit configured in express.json().",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            example: { error: "Payload too large" },
          },
        },
      },
      TooManyRequests: {
        description:
          "Rate limit exceeded (global or endpoint-specific limiter).",
        headers: {
          RateLimit: { $ref: "#/components/headers/RateLimit" },
          "RateLimit-Policy": { $ref: "#/components/headers/RateLimitPolicy" },
        },
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            example: { error: "Too many requests, please try again later" },
          },
        },
      },
      InternalServerError: {
        description: "Unexpected server error handled by createErrorHandler.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            example: { error: "Internal server error" },
          },
        },
      },
    },
  };
}

// ============================================================================
// Endpoint Metadata Catalog (Derived Strictly From Routes, Services & Models)
// ============================================================================

const RATE_LIMIT_SPECS: Record<
  RateLimiterId,
  {
    windowMs: number;
    defaultLimit: number | string;
    skipSuccessfulRequests: boolean;
  }
> = {
  global: {
    windowMs: 420_000,
    defaultLimit: 300,
    skipSuccessfulRequests: false,
  },
  register: {
    windowMs: 900_000,
    defaultLimit: "env.registerRateLimit (default 10)",
    skipSuccessfulRequests: false,
  },
  login: {
    windowMs: 900_000,
    defaultLimit: "env.loginRateLimit (default 10)",
    skipSuccessfulRequests: true,
  },
  refresh: {
    windowMs: 900_000,
    defaultLimit:
      "env.refreshRateLimit (default 30; rate-limiter filter exempts 409 though /refresh emits 200 or 401)",
    skipSuccessfulRequests: true,
  },
};

function jsonBodyRef(schemaName: string): JsonObject {
  return {
    "application/json": {
      schema: { $ref: `#/components/schemas/${schemaName}` },
    },
  };
}

function jsonInline(schema: JsonObject, example?: unknown): JsonObject {
  return {
    "application/json": {
      schema,
      ...(example !== undefined ? { example } : {}),
    },
  };
}

function jsonErrorWithMalformedExample(
  primaryKey: string,
  primaryError: string,
  extraExamples: Record<string, { value: Record<string, unknown> }> = {},
): JsonObject {
  return {
    "application/json": {
      schema: { $ref: "#/components/schemas/ErrorResponse" },
      examples: {
        [primaryKey]: { value: { error: primaryError } },
        ...extraExamples,
        malformedJson: { value: { error: "Bad request" } },
      },
    },
  };
}

const ENDPOINT_SPECS: Record<string, EndpointMetadata> = {
  "GET /api/health": {
    operationId: "getHealth",
    tags: ["Health"],
    summary: "Liveness check",
    description:
      'Returns `{ status: "ok" }` when the HTTP server is responsive.',
    responses: {
      "200": {
        description: "Server is alive.",
        content: jsonInline(
          {
            type: "object",
            required: ["status"],
            properties: { status: { type: "string", enum: ["ok"] } },
          },
          { status: "ok" },
        ),
      },
      "429": { $ref: "#/components/responses/TooManyRequests" },
    },
  },

  "GET /api/ready": {
    operationId: "getReadiness",
    tags: ["Health"],
    summary: "Readiness check",
    description:
      "Checks whether Mongoose is connected (`mongoose.connection.readyState === 1`).",
    responses: {
      "200": {
        description: "MongoDB connection is ready.",
        content: jsonInline(
          {
            type: "object",
            required: ["status"],
            properties: { status: { type: "string", enum: ["ready"] } },
          },
          { status: "ready" },
        ),
      },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "503": {
        description: "MongoDB connection is not ready.",
        content: jsonInline(
          {
            type: "object",
            required: ["status"],
            properties: { status: { type: "string", enum: ["unavailable"] } },
          },
          { status: "unavailable" },
        ),
      },
    },
  },

  "POST /api/auth/register": {
    operationId: "registerUser",
    tags: ["Auth"],
    summary: "Register a new user account",
    description:
      "Validates registration details with `registerSchema`, hashes the password using Argon2id, creates a User document, and returns the sanitized public user.",
    requestBody: {
      required: true,
      description: "New user registration payload.",
      schemaRef: "RegisterRequest",
    },
    responses: {
      "201": {
        description: "User account created.",
        content: jsonBodyRef("UserResponse"),
      },
      "400": {
        description: "Validation failed or malformed JSON body.",
        content: jsonErrorWithMalformedExample(
          "invalidDetails",
          "Invalid registration details",
        ),
      },
      "409": {
        description:
          "Email or username already exists (MongoDB duplicate key 11000).",
        content: jsonInline(
          { $ref: "#/components/schemas/ErrorResponse" },
          { error: "Email or username is already in use" },
        ),
      },
      "413": { $ref: "#/components/responses/PayloadTooLarge" },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "500": { $ref: "#/components/responses/InternalServerError" },
    },
  },

  "POST /api/auth/login": {
    operationId: "loginUser",
    tags: ["Auth"],
    summary: "Authenticate and create a session",
    description:
      "Authenticates credentials, enforces per-user `maxSessions` (default 3; optional `revokeSessionId` supports `'all'` or a specific session ObjectId), sets the `refreshToken` HttpOnly cookie, and returns a Bearer access token. Automatically infers `device` and session `name` from the `User-Agent` header when omitted.",
    requestBody: {
      required: true,
      description: "User credentials and optional session metadata.",
      schemaRef: "LoginRequest",
    },
    responses: {
      "200": {
        description: "Login succeeded; refresh token set in HttpOnly cookie.",
        headers: {
          "Set-Cookie": { $ref: "#/components/headers/SetRefreshCookie" },
        },
        content: jsonBodyRef("LoginSuccessResponse"),
      },
      "400": {
        description:
          "Request body failed `credentialsSchema` validation or malformed JSON.",
        content: jsonErrorWithMalformedExample(
          "invalidCredentials",
          "Invalid email or password",
        ),
      },
      "401": {
        description: "Email not found or password verification failed.",
        content: jsonInline(
          { $ref: "#/components/schemas/ErrorResponse" },
          { error: "Invalid email or password" },
        ),
      },
      "409": {
        description:
          "Active session limit reached (`MAX_SESSIONS_REACHED`); includes active sessions so the caller can pass `revokeSessionId`.",
        content: jsonBodyRef("MaxSessionsReachedResponse"),
      },
      "413": { $ref: "#/components/responses/PayloadTooLarge" },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "500": { $ref: "#/components/responses/InternalServerError" },
    },
  },

  "POST /api/auth/refresh": {
    operationId: "refreshAccessToken",
    tags: ["Auth"],
    summary: "Rotate refresh token and issue a new access token",
    description:
      "Reads the refresh token from the `refreshToken` HttpOnly cookie (or falls back to `req.body.refreshToken`). Rotates both refresh and access tokens, detects stale token reuse (revoking the entire session), sets the new `refreshToken` cookie on success, and clears the cookie if a presented token fails rotation.",
    securityOverride: [{ refreshCookie: [] }, {}],
    requestBody: {
      required: false,
      description:
        "Optional JSON fallback containing `refreshToken` when not sent via HttpOnly cookie.",
      schemaRef: "RefreshTokenBodyRequest",
    },
    responses: {
      "200": {
        description:
          "Token rotated; new refreshToken cookie set and new accessToken returned.",
        headers: {
          "Set-Cookie": { $ref: "#/components/headers/SetRefreshCookie" },
        },
        content: jsonBodyRef("RefreshSuccessResponse"),
      },
      "400": {
        description: "Malformed JSON body.",
        content: jsonInline(
          { $ref: "#/components/schemas/ErrorResponse" },
          { error: "Bad request" },
        ),
      },
      "401": {
        description:
          "Refresh token missing, invalid, expired, or reused. When a token was presented and rejected, `Set-Cookie` clears `refreshToken`.",
        headers: {
          "Set-Cookie": { $ref: "#/components/headers/ClearRefreshCookie" },
        },
        content: jsonInline(
          { $ref: "#/components/schemas/ErrorResponse" },
          { error: "Invalid refresh token" },
        ),
      },
      "413": { $ref: "#/components/responses/PayloadTooLarge" },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "500": { $ref: "#/components/responses/InternalServerError" },
    },
  },

  "POST /api/auth/logout": {
    operationId: "logoutUser",
    tags: ["Auth"],
    summary: "Revoke the caller's session and clear the refresh cookie",
    description:
      "Revokes the session identified by the `refreshToken` cookie, `req.body.refreshToken`, or `Authorization: Bearer <token>` header (in that order), and always clears the `refreshToken` cookie before returning `204`.",
    securityOverride: [{ refreshCookie: [] }, { bearerAuth: [] }, {}],
    requestBody: {
      required: false,
      description:
        "Optional JSON fallback containing `refreshToken` when not authenticating via cookie or Bearer header.",
      schemaRef: "RefreshTokenBodyRequest",
    },
    responses: {
      "204": {
        description:
          "Session revoked (if valid token supplied) and refreshToken cookie cleared.",
        headers: {
          "Set-Cookie": { $ref: "#/components/headers/ClearRefreshCookie" },
        },
      },
      "400": {
        description: "Malformed JSON body.",
        content: jsonInline(
          { $ref: "#/components/schemas/ErrorResponse" },
          { error: "Bad request" },
        ),
      },
      "413": { $ref: "#/components/responses/PayloadTooLarge" },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "500": { $ref: "#/components/responses/InternalServerError" },
    },
  },

  "GET /api/auth/me": {
    operationId: "getCurrentUser",
    tags: ["Auth"],
    summary: "Get authenticated user profile",
    description:
      "Returns the sanitized public profile of the currently authenticated user.",
    responses: {
      "200": {
        description: "Authenticated user profile.",
        content: jsonBodyRef("UserResponse"),
      },
      "401": { $ref: "#/components/responses/Unauthorized" },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "500": { $ref: "#/components/responses/InternalServerError" },
    },
  },

  "POST /api/auth/change-password": {
    operationId: "changePassword",
    tags: ["Auth"],
    summary: "Change password and revoke other sessions",
    description:
      "Verifies `currentPassword`, updates the Argon2id password hash, and deletes all active sessions for the user except the caller's current session.",
    requestBody: {
      required: true,
      description: "Current and new passwords.",
      schemaRef: "ChangePasswordRequest",
    },
    responses: {
      "204": {
        description: "Password updated and all other sessions revoked.",
      },
      "400": {
        description:
          "Validation failed, current password incorrect, or malformed JSON.",
        content: jsonErrorWithMalformedExample(
          "invalidDetails",
          "Invalid password details",
          {
            wrongPassword: {
              value: { error: "Current password is incorrect" },
            },
          },
        ),
      },
      "401": { $ref: "#/components/responses/Unauthorized" },
      "413": { $ref: "#/components/responses/PayloadTooLarge" },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "500": { $ref: "#/components/responses/InternalServerError" },
    },
  },

  "GET /api/sessions": {
    operationId: "listSessions",
    tags: ["Sessions"],
    summary: "List active sessions",
    description:
      "Lists all non-expired sessions for the authenticated user, ordered by `createdAt` descending, marking the caller's session with `current: true`.",
    responses: {
      "200": {
        description: "Active sessions list.",
        content: jsonInline({
          type: "object",
          required: ["sessions"],
          properties: {
            sessions: {
              type: "array",
              items: { $ref: "#/components/schemas/SanitizedSession" },
            },
          },
        }),
      },
      "401": { $ref: "#/components/responses/Unauthorized" },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "500": { $ref: "#/components/responses/InternalServerError" },
    },
  },

  "PATCH /api/sessions/{id}": {
    operationId: "renameSession",
    tags: ["Sessions"],
    summary: "Rename a session",
    description:
      "Updates the user-friendly `name` of a session belonging to the authenticated user.",
    pathParameters: [
      {
        name: "id",
        in: "path",
        required: true,
        description:
          "Session identifier (24-character hex MongoDB ObjectId; invalid formats return 404 Session not found).",
        schema: { type: "string" },
      },
    ],
    requestBody: {
      required: true,
      description: "New session name.",
      schemaRef: "UpdateSessionNameRequest",
    },
    responses: {
      "200": {
        description: "Session renamed.",
        content: jsonInline(
          {
            type: "object",
            required: ["success"],
            properties: { success: { type: "boolean", enum: [true] } },
          },
          { success: true },
        ),
      },
      "400": {
        description: "Invalid session name or malformed JSON.",
        content: jsonErrorWithMalformedExample(
          "invalidSessionName",
          "Invalid session name",
        ),
      },
      "401": { $ref: "#/components/responses/Unauthorized" },
      "404": { $ref: "#/components/responses/SessionNotFound" },
      "413": { $ref: "#/components/responses/PayloadTooLarge" },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "500": { $ref: "#/components/responses/InternalServerError" },
    },
  },

  "DELETE /api/sessions": {
    operationId: "revokeAllSessions",
    tags: ["Sessions"],
    summary: "Revoke all sessions",
    description:
      "Deletes all sessions for the authenticated user, optionally keeping the current session when `?exceptCurrent=true`.",
    extraQueryParameters: [
      {
        name: "exceptCurrent",
        in: "query",
        required: false,
        description:
          "When strictly `'true'`, preserves the caller's current session (`req.query.exceptCurrent === 'true'`; other values such as `'false'` or `'1'` evaluate as false and do not return 400).",
        schema: { type: "boolean" },
      },
    ],
    responses: {
      "200": {
        description: "Number of revoked sessions.",
        content: jsonInline(
          {
            type: "object",
            required: ["revoked"],
            properties: {
              revoked: { type: "integer", minimum: 0 },
            },
          },
          { revoked: 2 },
        ),
      },
      "401": { $ref: "#/components/responses/Unauthorized" },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "500": { $ref: "#/components/responses/InternalServerError" },
    },
  },

  "DELETE /api/sessions/{id}": {
    operationId: "revokeSessionById",
    tags: ["Sessions"],
    summary: "Revoke a specific session",
    description:
      "Deletes a single session belonging to the authenticated user by ID.",
    pathParameters: [
      {
        name: "id",
        in: "path",
        required: true,
        description:
          "Session identifier (24-character hex MongoDB ObjectId; invalid formats return 404 Session not found).",
        schema: { type: "string" },
      },
    ],
    responses: {
      "204": { description: "Session revoked." },
      "401": { $ref: "#/components/responses/Unauthorized" },
      "404": { $ref: "#/components/responses/SessionNotFound" },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "500": { $ref: "#/components/responses/InternalServerError" },
    },
  },

  "GET /api/conversations": {
    operationId: "listConversations",
    tags: ["Conversations"],
    summary: "List visible conversations",
    description:
      "Returns non-hidden conversations for the authenticated user sorted by `updatedAt` descending, resolving direct conversation `name` dynamically from the counterpart user's `displayName` when no custom name is set.",
    responses: {
      "200": {
        description: "Visible conversations list.",
        content: jsonInline({
          type: "object",
          required: ["conversations"],
          properties: {
            conversations: {
              type: "array",
              items: { $ref: "#/components/schemas/Conversation" },
            },
          },
        }),
      },
      "401": { $ref: "#/components/responses/Unauthorized" },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "500": { $ref: "#/components/responses/InternalServerError" },
    },
  },

  "POST /api/conversations/direct": {
    operationId: "createOrRestoreDirectConversation",
    tags: ["Conversations"],
    summary: "Create or restore a direct conversation",
    description:
      "Creates a 1-on-1 direct conversation with `participantId` (201) or returns/unhides an existing one (200).",
    requestBody: {
      required: true,
      description: "Target participant identifier.",
      schemaRef: "DirectConversationRequest",
    },
    responses: {
      "200": {
        description:
          "Existing direct conversation returned or restored from hiddenFor.",
        content: jsonBodyRef("ConversationResponse"),
      },
      "201": {
        description: "New direct conversation created.",
        content: jsonBodyRef("ConversationResponse"),
      },
      "400": {
        description:
          "Invalid body, invalid ObjectId, self-conversation attempt, or malformed JSON.",
        content: jsonErrorWithMalformedExample(
          "invalidParticipant",
          "Invalid participant",
        ),
      },
      "401": { $ref: "#/components/responses/Unauthorized" },
      "404": {
        description: "Target participant user does not exist.",
        content: jsonInline(
          { $ref: "#/components/schemas/ErrorResponse" },
          { error: "Participant not found" },
        ),
      },
      "413": { $ref: "#/components/responses/PayloadTooLarge" },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "500": { $ref: "#/components/responses/InternalServerError" },
    },
  },

  "POST /api/conversations/{conversationId}/hide": {
    operationId: "hideConversation",
    tags: ["Conversations"],
    summary: "Hide a conversation for the caller",
    description:
      "Adds the authenticated user's ID to the conversation's `hiddenFor` set without affecting the other participant.",
    pathParameters: [
      {
        name: "conversationId",
        in: "path",
        required: true,
        description:
          "Conversation identifier (24-character hex MongoDB ObjectId; invalid formats return 404 Conversation not found).",
        schema: { type: "string" },
      },
    ],
    responses: {
      "204": { description: "Conversation hidden for caller." },
      "401": { $ref: "#/components/responses/Unauthorized" },
      "404": { $ref: "#/components/responses/ConversationNotFound" },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "500": { $ref: "#/components/responses/InternalServerError" },
    },
  },

  "PATCH /api/conversations/{conversationId}": {
    operationId: "updateConversation",
    tags: ["Conversations"],
    summary: "Update conversation metadata",
    description:
      "Updates `name` and/or `avatarUrl` on a conversation where the caller is a participant. Setting `name` to `null` reverts to the counterpart's `displayName` for direct chats.",
    pathParameters: [
      {
        name: "conversationId",
        in: "path",
        required: true,
        description:
          "Conversation identifier (24-character hex MongoDB ObjectId; invalid formats return 404 Conversation not found).",
        schema: { type: "string" },
      },
    ],
    requestBody: {
      required: true,
      description: "Metadata fields to update.",
      schemaRef: "ConversationUpdateRequest",
    },
    responses: {
      "200": {
        description: "Updated conversation.",
        content: jsonBodyRef("ConversationResponse"),
      },
      "400": {
        description: "Validation failed or malformed JSON.",
        content: jsonErrorWithMalformedExample(
          "invalidDetails",
          "Invalid conversation details",
        ),
      },
      "401": { $ref: "#/components/responses/Unauthorized" },
      "404": { $ref: "#/components/responses/ConversationNotFound" },
      "413": { $ref: "#/components/responses/PayloadTooLarge" },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "500": { $ref: "#/components/responses/InternalServerError" },
    },
  },

  "GET /api/conversations/{conversationId}/messages": {
    operationId: "listMessages",
    tags: ["Messages"],
    summary: "List paginated messages in a conversation",
    description:
      "Retrieves messages in reverse chronological (`_id` descending) order using cursor pagination.",
    pathParameters: [
      {
        name: "conversationId",
        in: "path",
        required: true,
        description:
          "Conversation identifier (24-character hex MongoDB ObjectId; invalid formats return 400 Invalid conversation ID).",
        schema: { type: "string" },
      },
    ],
    queryZodSchema: listMessagesQuerySchema,
    queryParameterOverrides: {
      cursor: {
        description:
          "Optional message ObjectId cursor (24-character hex string, trimmed; validated via Types.ObjectId.isValid). Returns messages older than this cursor.",
        schema: {
          type: "string",
          pattern: OBJECT_ID_PATTERN,
          "x-zod-refine": "Types.ObjectId.isValid",
        },
      },
      limit: {
        description:
          "Maximum number of messages to return (integer coerced from query string, 1-100, default 30).",
      },
    },
    responses: {
      "200": {
        description: "Paginated messages list.",
        content: jsonInline({
          type: "object",
          required: ["messages", "nextCursor"],
          properties: {
            messages: {
              type: "array",
              items: { $ref: "#/components/schemas/Message" },
            },
            nextCursor: {
              type: "string",
              pattern: OBJECT_ID_PATTERN,
              nullable: true,
            },
          },
        }),
      },
      "400": {
        description: "Invalid query parameters or invalid conversation ID.",
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/ErrorResponse" },
            examples: {
              invalidQuery: { value: { error: "Invalid query parameters" } },
              invalidConversationId: {
                value: { error: "Invalid conversation ID" },
              },
            },
          },
        },
      },
      "401": { $ref: "#/components/responses/Unauthorized" },
      "403": { $ref: "#/components/responses/ConversationForbidden" },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "500": { $ref: "#/components/responses/InternalServerError" },
    },
  },

  "POST /api/conversations/{conversationId}/messages": {
    operationId: "sendMessage",
    tags: ["Messages"],
    summary: "Send a message in a conversation",
    description:
      "Persists a new message (201) or returns an existing message when `clientId` matches an earlier submission by the same sender (200). Unhides the conversation for all participants, updates `lastMessage`/`lastMessageAt`, and broadcasts `message:new` over Socket.io when initialized.",
    pathParameters: [
      {
        name: "conversationId",
        in: "path",
        required: true,
        description:
          "Conversation identifier (24-character hex MongoDB ObjectId; invalid formats return 400 Invalid conversation ID).",
        schema: { type: "string" },
      },
    ],
    requestBody: {
      required: true,
      description: "Message payload.",
      schemaRef: "SendMessageRequest",
    },
    responses: {
      "200": {
        description: "Duplicate submission matched by `clientId` (idempotent).",
        content: jsonBodyRef("MessageResponse"),
      },
      "201": {
        description: "New message created.",
        content: jsonBodyRef("MessageResponse"),
      },
      "400": {
        description:
          "Zod body validation failed (flattened error details), invalid conversation ID, or malformed JSON.",
        content: {
          "application/json": {
            schema: {
              anyOf: [
                { $ref: "#/components/schemas/ValidationErrorResponse" },
                { $ref: "#/components/schemas/ErrorResponse" },
              ],
            },
            examples: {
              validationFailed: {
                value: {
                  error: "Validation failed",
                  details: {
                    formErrors: [],
                    fieldErrors: {
                      content: ["Message content cannot be empty"],
                    },
                  },
                },
              },
              invalidConversationId: {
                value: { error: "Invalid conversation ID" },
              },
              malformedJson: {
                value: { error: "Bad request" },
              },
            },
          },
        },
      },
      "401": { $ref: "#/components/responses/Unauthorized" },
      "403": { $ref: "#/components/responses/ConversationForbidden" },
      "413": { $ref: "#/components/responses/PayloadTooLarge" },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "500": { $ref: "#/components/responses/InternalServerError" },
    },
  },

  "PATCH /api/conversations/{conversationId}/messages/{messageId}/read": {
    operationId: "markMessageAsRead",
    tags: ["Messages"],
    summary: "Mark a message as read",
    description:
      "Records a read receipt for the authenticated user on the target message and broadcasts `message:read_update` over Socket.io when initialized.",
    pathParameters: [
      {
        name: "conversationId",
        in: "path",
        required: true,
        description:
          "Conversation identifier (24-character hex MongoDB ObjectId).",
        schema: { type: "string" },
      },
      {
        name: "messageId",
        in: "path",
        required: true,
        description: "Message identifier (24-character hex MongoDB ObjectId).",
        schema: { type: "string" },
      },
    ],
    responses: {
      "200": {
        description: "Message marked as read.",
        content: jsonInline(
          {
            type: "object",
            required: ["status"],
            properties: { status: { type: "string", enum: ["ok"] } },
          },
          { status: "ok" },
        ),
      },
      "400": {
        description: "Invalid conversationId or messageId format.",
        content: jsonInline(
          { $ref: "#/components/schemas/ErrorResponse" },
          { error: "Invalid IDs provided" },
        ),
      },
      "401": { $ref: "#/components/responses/Unauthorized" },
      "403": { $ref: "#/components/responses/ConversationForbidden" },
      "404": {
        description: "Message not found in this conversation.",
        content: jsonInline(
          { $ref: "#/components/schemas/ErrorResponse" },
          { error: "Message not found" },
        ),
      },
      "429": { $ref: "#/components/responses/TooManyRequests" },
      "500": { $ref: "#/components/responses/InternalServerError" },
    },
  },
};

// ============================================================================
// OpenAPI Document Assembly
// ============================================================================

function buildQueryParameters(meta: EndpointMetadata): ParameterMetadata[] {
  const params: ParameterMetadata[] = [];

  if (meta.queryZodSchema) {
    const converted = convertZodToOpenApiSchema(meta.queryZodSchema);
    const props = (converted.properties ?? {}) as Record<string, JsonObject>;
    const requiredSet = new Set<string>((converted.required as string[]) ?? []);

    for (const [name, propSchema] of Object.entries(props)) {
      const override = meta.queryParameterOverrides?.[name];
      params.push({
        name,
        in: "query",
        required: override?.required ?? requiredSet.has(name),
        description:
          override?.description ??
          (typeof propSchema.description === "string"
            ? propSchema.description
            : `Query parameter '${name}'.`),
        schema: override?.schema ?? propSchema,
      });
    }
  }

  if (meta.extraQueryParameters) {
    params.push(...meta.extraQueryParameters);
  }

  return params;
}

function buildOperation(
  route: DiscoveredRoute,
  meta: EndpointMetadata,
): JsonObject {
  const security: SecurityRequirement[] =
    meta.securityOverride !== undefined
      ? meta.securityOverride
      : route.requiresAuth
        ? [{ bearerAuth: [] }]
        : [];

  const parameters = [
    ...(meta.pathParameters ?? []),
    ...buildQueryParameters(meta),
  ];

  const operation: JsonObject = {
    tags: meta.tags,
    operationId: meta.operationId,
    summary: meta.summary,
    description: meta.description,
    security,
  };

  if (parameters.length > 0) {
    operation.parameters = parameters;
  }

  if (meta.requestBody) {
    const contentSchema = meta.requestBody.schemaRef
      ? { $ref: `#/components/schemas/${meta.requestBody.schemaRef}` }
      : meta.requestBody.schema;
    operation.requestBody = {
      required: meta.requestBody.required,
      description: meta.requestBody.description,
      content: {
        "application/json": {
          schema: contentSchema,
        },
      },
    };
  }

  if (route.rateLimiters.length > 0) {
    operation["x-rate-limit"] = route.rateLimiters.map((id) => ({
      limiter: id,
      ...RATE_LIMIT_SPECS[id],
    }));
  }

  operation.responses = meta.responses;
  return operation;
}

interface PackageMetadata {
  version: string;
  license?: string;
}

function readJsonStringField(
  filePath: string,
  key: string,
): string | undefined {
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Record<
      string,
      unknown
    >;
    return typeof raw[key] === "string" && raw[key].trim().length > 0
      ? raw[key].trim()
      : undefined;
  } catch {
    return undefined;
  }
}

function loadPackageMetadata(): PackageMetadata {
  return {
    version:
      readJsonStringField(BACKEND_PACKAGE_JSON_PATH, "version") ??
      readJsonStringField(ROOT_PACKAGE_JSON_PATH, "version") ??
      "0.0.0",
    license:
      readJsonStringField(BACKEND_PACKAGE_JSON_PATH, "license") ??
      readJsonStringField(ROOT_PACKAGE_JSON_PATH, "license"),
  };
}

function buildOpenApiDocument(discoveredRoutes: DiscoveredRoute[]): JsonObject {
  const paths: Record<string, Record<string, JsonObject>> = {};
  const pkg = loadPackageMetadata();

  for (const route of discoveredRoutes) {
    const key = `${route.method.toUpperCase()} ${route.openApiPath}`;
    const meta = ENDPOINT_SPECS[key];
    if (!meta) {
      throw new Error(
        `Discovered Express route '${key}' is missing from ENDPOINT_SPECS.`,
      );
    }

    paths[route.openApiPath] ??= {};
    paths[route.openApiPath][route.method] = buildOperation(route, meta);
  }

  return {
    openapi: "3.0.3",
    info: {
      title: "MyChat Backend API",
      version: pkg.version,
      ...(pkg.license ? { license: { name: pkg.license } } : {}),
      description: [
        "REST API specification for the MyChat Express 5 + TypeScript + Zod + MongoDB backend.",
        "",
        "Authentication uses short-lived HS256 JWT access tokens in the `Authorization: Bearer <token>` header",
        "paired with an `HttpOnly`, `SameSite=Lax` (`Secure` in production) `refreshToken` cookie scoped to `/api/auth`.",
        "All `/api/*` routes are subject to global rate limiting, emitting `draft-8` `RateLimit` / `RateLimit-Policy` headers on `/api/*` responses (not only `429`).",
        '`express.json({ limit: "16kb" })` runs globally before route handlers, so malformed or oversized JSON bodies return `400` (`Bad request`) or `413` (`Payload too large`) even on endpoints without a declared `requestBody`.',
        "String request fields backed by Zod schemas with `.trim()` are trimmed prior to regex, length, and `ObjectId` validation.",
        "Real-time WebSocket events (Socket.io) share the same HTTP server outside REST `paths`.",
      ].join("\n"),
    },
    servers: [
      {
        url: "/",
        description:
          "Relative API root (same-origin deployment; in local development Express listens on PORT=3000 by default from src/config/env.ts)",
      },
    ],
    tags: [
      {
        name: "Health",
        description: "System liveness and database readiness endpoints.",
      },
      {
        name: "Auth",
        description:
          "Account registration, login, token rotation, logout, profile, and password updates.",
      },
      {
        name: "Sessions",
        description: "Active session inspection, naming, and revocation.",
      },
      {
        name: "Conversations",
        description:
          "Direct conversation creation, listing, hiding, and metadata updates.",
      },
      {
        name: "Messages",
        description:
          "Cursor-paginated message history, sending, and read receipts.",
      },
    ],
    paths,
    components: buildReusableComponents(),
  };
}

// ============================================================================
// Validation (Route Parity, Security, Path Params, Refs, OpenAPI 3.0.3 Rules)
// ============================================================================

function resolveJsonPointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) {
    throw new Error(`Unsupported non-local $ref: ${ref}`);
  }
  const parts = ref
    .slice(2)
    .split("/")
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"));
  let current: unknown = root;
  for (const part of parts) {
    if (typeof current !== "object" || current === null || !(part in current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function validateOpenApiDocument(
  doc: JsonObject,
  discoveredRoutes: DiscoveredRoute[],
): void {
  if (doc.openapi !== "3.0.3") {
    throw new Error(`Expected openapi 3.0.3, received ${String(doc.openapi)}`);
  }

  const paths = doc.paths as Record<string, Record<string, JsonObject>>;
  const discoveredKeys = new Set(
    discoveredRoutes.map((r) => `${r.method.toUpperCase()} ${r.openApiPath}`),
  );
  const specKeys = new Set(Object.keys(ENDPOINT_SPECS));

  for (const key of specKeys) {
    if (!discoveredKeys.has(key)) {
      throw new Error(
        `Stale ENDPOINT_SPECS entry '${key}' was not found in Express app.`,
      );
    }
  }

  for (const route of discoveredRoutes) {
    const operation = paths[route.openApiPath]?.[route.method];
    if (!operation) {
      throw new Error(
        `Missing OpenAPI operation for ${route.method.toUpperCase()} ${route.openApiPath}`,
      );
    }

    // Security consistency with requireAuth middleware
    const meta =
      ENDPOINT_SPECS[`${route.method.toUpperCase()} ${route.openApiPath}`];
    if (meta.securityOverride === undefined) {
      const sec = operation.security as SecurityRequirement[];
      const hasBearer = sec.some((entry) => "bearerAuth" in entry);
      if (hasBearer !== route.requiresAuth) {
        throw new Error(
          `Security mismatch on ${route.method.toUpperCase()} ${route.openApiPath}: requiresAuth=${route.requiresAuth}, hasBearer=${hasBearer}`,
        );
      }
    }

    // Path parameter consistency
    const templateParams = Array.from(
      route.openApiPath.matchAll(/\{([A-Za-z0-9_]+)\}/g),
      (m) => m[1],
    );
    const declaredParams = (
      (operation.parameters as ParameterMetadata[] | undefined) ?? []
    ).filter((p) => p.in === "path");

    if (templateParams.length !== declaredParams.length) {
      throw new Error(
        `Path parameter count mismatch on ${route.method.toUpperCase()} ${route.openApiPath}`,
      );
    }
    for (const paramName of templateParams) {
      const found = declaredParams.find((p) => p.name === paramName);
      if (!found || !found.required) {
        throw new Error(
          `Missing or non-required path parameter '${paramName}' on ${route.method.toUpperCase()} ${route.openApiPath}`,
        );
      }
    }

    const responses = operation.responses as
      Record<string, unknown> | undefined;
    if (!responses || Object.keys(responses).length === 0) {
      throw new Error(
        `Empty responses on ${route.method.toUpperCase()} ${route.openApiPath}`,
      );
    }
  }

  // Recursive check for $refs and forbidden JSON Schema Draft 2020-12 constructs
  function inspectNode(node: unknown, nodePath: string): void {
    if (Array.isArray(node)) {
      node.forEach((item, index) => inspectNode(item, `${nodePath}[${index}]`));
      return;
    }
    if (typeof node !== "object" || node === null) return;

    const record = node as Record<string, unknown>;
    if ("$schema" in record) {
      throw new Error(`Disallowed '$schema' key at ${nodePath}`);
    }
    if (Array.isArray(record.type)) {
      throw new Error(`OpenAPI 3.0.3 disallows array 'type' at ${nodePath}`);
    }
    if (typeof record.$ref === "string") {
      const resolved = resolveJsonPointer(doc, record.$ref);
      if (resolved === undefined) {
        throw new Error(`Unresolved $ref '${record.$ref}' at ${nodePath}`);
      }
    }
    for (const [k, v] of Object.entries(record)) {
      inspectNode(v, `${nodePath}.${k}`);
    }
  }

  inspectNode(doc, "#");
}

// ============================================================================
// Deterministic YAML 1.2 Serializer (Zero External Dependencies)
// ============================================================================

const SIMPLE_KEY_RE = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const YAML_KEYWORD_RE =
  /^(?:true|false|yes|no|on|off|y|n|null|~|\.inf|\.nan)$/i;
const NUMERIC_LIKE_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const SAFE_PLAIN_SCALAR_RE = /^[A-Za-z0-9_./@-][A-Za-z0-9_./@ -]*$/;

function formatYamlKey(key: string): string {
  if (
    SIMPLE_KEY_RE.test(key) &&
    !YAML_KEYWORD_RE.test(key) &&
    !NUMERIC_LIKE_RE.test(key)
  ) {
    return key;
  }
  return JSON.stringify(key);
}

function shouldQuoteString(value: string): boolean {
  if (value.length === 0) return true;
  if (/^\s|\s$/.test(value)) return true;
  if (YAML_KEYWORD_RE.test(value) || NUMERIC_LIKE_RE.test(value)) return true;
  if (/^0[xXoObB]/.test(value)) return true;
  if (/:(?:\s|$)|\s#/.test(value)) return true;
  if (!SAFE_PLAIN_SCALAR_RE.test(value)) return true;
  return false;
}

function hasUnsupportedMultilineControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 10) continue; // '\n' allowed in YAML block scalar
    if (code < 32 || code === 127) return true;
  }
  return false;
}

function serializeYamlValue(value: unknown, indent: number): string {
  const pad = " ".repeat(indent);

  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Non-finite number cannot be serialized: ${value}`);
    }
    return String(value);
  }
  if (typeof value === "string") {
    if (value.includes("\n") && !hasUnsupportedMultilineControlChars(value)) {
      const lines = value.split("\n");
      const blockPad = " ".repeat(indent + 2);
      return `|-\n${lines.map((line) => (line.length > 0 ? `${blockPad}${line}` : "")).join("\n")}`;
    }
    return shouldQuoteString(value) ? JSON.stringify(value) : value;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const lines: string[] = [];
    for (const item of value) {
      if (
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        Object.keys(item).length > 0
      ) {
        const entries = Object.entries(item).filter(([, v]) => v !== undefined);
        entries.forEach(([k, v], idx) => {
          const formattedKey = formatYamlKey(k);
          const itemPrefix = idx === 0 ? `${pad}- ` : `${pad}  `;
          const childIndent = indent + 2;
          if (isInlineScalarOrEmpty(v)) {
            lines.push(
              `${itemPrefix}${formattedKey}: ${serializeYamlValue(v, childIndent)}`,
            );
          } else {
            lines.push(`${itemPrefix}${formattedKey}:`);
            lines.push(serializeYamlBlock(v, childIndent + 2));
          }
        });
      } else if (isInlineScalarOrEmpty(item)) {
        lines.push(`${pad}- ${serializeYamlValue(item, indent)}`);
      } else {
        lines.push(`${pad}-`);
        lines.push(serializeYamlBlock(item, indent + 2));
      }
    }
    return lines.join("\n");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(
      ([, v]) => v !== undefined,
    );
    if (entries.length === 0) return "{}";
    return serializeObjectEntries(entries, indent);
  }

  throw new Error(
    `Unsupported value type in YAML serialization: ${typeof value}`,
  );
}

function isInlineScalarOrEmpty(value: unknown): boolean {
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return true;
  }
  if (typeof value === "string") {
    return true;
  }
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") {
    return (
      Object.entries(value as Record<string, unknown>).filter(
        ([, v]) => v !== undefined,
      ).length === 0
    );
  }
  return false;
}

function serializeObjectEntries(
  entries: Array<[string, unknown]>,
  indent: number,
): string {
  const pad = " ".repeat(indent);
  const lines: string[] = [];

  for (const [key, val] of entries) {
    const formattedKey = formatYamlKey(key);
    if (isInlineScalarOrEmpty(val)) {
      lines.push(`${pad}${formattedKey}: ${serializeYamlValue(val, indent)}`);
    } else {
      lines.push(`${pad}${formattedKey}:`);
      lines.push(serializeYamlBlock(val, indent + 2));
    }
  }

  return lines.join("\n");
}

function serializeYamlBlock(value: unknown, indent: number): string {
  return serializeYamlValue(value, indent);
}

function toYaml(document: JsonObject): string {
  return `${serializeYamlValue(document, 0)}\n`;
}

// ============================================================================
// Entry Point
// ============================================================================

async function main(): Promise<void> {
  const checkOnly = process.argv.includes("--check");
  const discoveredRoutes = await discoverExpressRoutes();
  const document = buildOpenApiDocument(discoveredRoutes);

  validateOpenApiDocument(document, discoveredRoutes);

  const yamlOutput = toYaml(document);

  if (checkOnly) {
    let existing: string;
    try {
      existing = readFileSync(OUTPUT_PATH, "utf8");
    } catch {
      console.error(`OpenAPI file not found at ${OUTPUT_PATH}`);
      process.exitCode = 1;
      return;
    }
    if (existing !== yamlOutput) {
      console.error(
        `OpenAPI specification at ${OUTPUT_PATH} is out of date. Run 'npm run generate:openapi'.`,
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `OpenAPI specification is up to date (${discoveredRoutes.length} endpoints verified).`,
    );
    return;
  }

  mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, yamlOutput, "utf8");

  console.log(
    `Generated ${path.relative(BACKEND_ROOT, OUTPUT_PATH)} (${discoveredRoutes.length} endpoints discovered and validated).`,
  );
}

await main();
