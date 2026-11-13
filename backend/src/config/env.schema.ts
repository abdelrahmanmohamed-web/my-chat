import { z } from "zod";

/**
 * Preprocesses string values from process.env into positive integers with a default fallback.
 */
function positiveIntWithDefault(defaultValue: number) {
  return z.preprocess(
    (val) => {
      if (val === undefined || val === null || val === "") return undefined;
      const num = Number(val);
      return Number.isSafeInteger(num) ? num : NaN;
    },
    z
      .number({ message: "Must be a valid integer" })
      .int("Must be an integer")
      .positive("Must be a positive integer")
      .default(defaultValue),
  );
}

/**
 * Zod schema for environment variables and secrets.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.preprocess(
      (val) =>
        val === undefined || val === null || val === "" ? undefined : val,
      z.enum(["development", "test", "production"]).default("development"),
    ),

    PORT: positiveIntWithDefault(3000),

    MONGODB_URI: z
      .string({ message: "MONGODB_URI is required" })
      .trim()
      .min(1, "MONGODB_URI cannot be empty")
      .refine(
        (uri) =>
          uri.startsWith("mongodb://") || uri.startsWith("mongodb+srv://"),
        {
          message:
            "MONGODB_URI must start with 'mongodb://' or 'mongodb+srv://'",
        },
      ),

    ACCESS_TOKEN_SECRET: z
      .string({ message: "ACCESS_TOKEN_SECRET is required" })
      .min(32, "ACCESS_TOKEN_SECRET must be at least 32 characters"),

    REFRESH_TOKEN_SECRET: z
      .string({ message: "REFRESH_TOKEN_SECRET is required" })
      .min(32, "REFRESH_TOKEN_SECRET must be at least 32 characters"),

    FRONTEND_URL: z.preprocess(
      (val) =>
        val === undefined || val === null || val === "" ? undefined : val,
      z
        .string()
        .url("FRONTEND_URL must be a valid URL")
        .default("http://localhost:5173"),
    ),

    JWT_ISSUER: z.preprocess(
      (val) =>
        val === undefined || val === null || val === "" ? undefined : val,
      z.string().min(1, "JWT_ISSUER cannot be empty").default("my-chat-api"),
    ),

    JWT_AUDIENCE: z.preprocess(
      (val) =>
        val === undefined || val === null || val === "" ? undefined : val,
      z
        .string()
        .min(1, "JWT_AUDIENCE cannot be empty")
        .default("my-chat-clients"),
    ),

    LOG_LEVEL: z.preprocess(
      (val) =>
        val === undefined || val === null || val === "" ? undefined : val,
      z
        .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
        .default("info"),
    ),

    TRUST_PROXY: z
      .preprocess(
        (val) =>
          val === undefined || val === null || val === "" ? undefined : val,
        z.string().optional(),
      )
      .refine((val) => val === undefined || /^\d+$/.test(val), {
        message: "TRUST_PROXY must be a non-negative integer",
      })
      .transform((val) => (val === undefined ? undefined : Number(val))),

    ACCESS_TTL: positiveIntWithDefault(14 * 60), // 14 minutes

    REFRESH_TTL_SECONDS: positiveIntWithDefault(14 * 24 * 60 * 60), // 14 days

    AUTH_LOGIN_RATE_LIMIT: positiveIntWithDefault(10),

    AUTH_REGISTER_RATE_LIMIT: positiveIntWithDefault(10),

    AUTH_REFRESH_RATE_LIMIT: positiveIntWithDefault(30),
  })
  .refine((data) => Buffer.byteLength(data.ACCESS_TOKEN_SECRET ?? "") >= 32, {
    message: "ACCESS_TOKEN_SECRET must be at least 32 bytes in length",
    path: ["ACCESS_TOKEN_SECRET"],
  })
  .refine((data) => Buffer.byteLength(data.REFRESH_TOKEN_SECRET ?? "") >= 32, {
    message: "REFRESH_TOKEN_SECRET must be at least 32 bytes in length",
    path: ["REFRESH_TOKEN_SECRET"],
  })
  .refine((data) => data.ACCESS_TOKEN_SECRET !== data.REFRESH_TOKEN_SECRET, {
    message: "REFRESH_TOKEN_SECRET must differ from ACCESS_TOKEN_SECRET",
    path: ["REFRESH_TOKEN_SECRET"],
  });

export type ValidatedEnv = z.infer<typeof envSchema>;

/**
 * Formats Zod errors into clean, readable console messages.
 */
export function formatEnvIssues(issues: z.ZodIssue[]): string[] {
  return issues.map((issue) => {
    const key = issue.path.join(".") || "Configuration";
    return `  ✖ [${key}]: ${issue.message}`;
  });
}

/**
 * Validates environment variables from process.env or a custom dictionary.
 * Throws a formatted Error if validation fails.
 */
export function validateEnv(
  source: Record<string, unknown> = process.env,
): ValidatedEnv {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    const formattedErrors = formatEnvIssues(result.error.issues);
    const errorMessage = [
      "Invalid environment configuration:",
      ...formattedErrors,
      "\nPlease check your environment variables or .env.secrets file.",
    ].join("\n");

    throw new Error(errorMessage);
  }

  return result.data;
}
