import { describe, expect, it } from "vitest";
import {
  AUTH_LIMITS,
  changePasswordSchema,
  isMaxSessionsReachedResponse,
  loginSchema,
  registerSchema,
  updateSessionNameSchema,
} from "@/types/auth";

describe("auth validation schemas", () => {
  it("accepts Arabic and English usernames with digits and underscores", () => {
    const arabicResult = registerSchema.safeParse({
      email: "ahmed@example.com",
      username: "أحمد_٢٠٢٦",
      displayName: "أحمد",
      password: "secret",
    });

    const englishResult = registerSchema.safeParse({
      email: "alice@example.com",
      username: "alice_01",
      displayName: "Alice",
      password: "secret",
    });

    expect(arabicResult.success).toBe(true);
    expect(englishResult.success).toBe(true);
  });

  it("rejects usernames with spaces, symbols, or fewer than 3 characters", () => {
    const shortResult = registerSchema.safeParse({
      email: "a@example.com",
      username: "ab",
      displayName: "A",
      password: "secret",
    });

    const invalidCharsResult = registerSchema.safeParse({
      email: "a@example.com",
      username: "bad user!",
      displayName: "A",
      password: "secret",
    });

    expect(shortResult.success).toBe(false);
    expect(invalidCharsResult.success).toBe(false);
  });

  it("enforces 6-character minimum and 128-character maximum passwords on register and change password", () => {
    expect(AUTH_LIMITS.passwordMinLength).toBe(6);

    const tooShortRegister = registerSchema.safeParse({
      email: "a@example.com",
      username: "valid_user",
      displayName: "User",
      password: "12345",
    });
    const exactMinRegister = registerSchema.safeParse({
      email: "a@example.com",
      username: "valid_user",
      displayName: "User",
      password: "123456",
    });
    const tooLongChange = changePasswordSchema.safeParse({
      currentPassword: "old-password",
      newPassword: "x".repeat(AUTH_LIMITS.passwordMaxLength + 1),
    });

    expect(tooShortRegister.success).toBe(false);
    expect(exactMinRegister.success).toBe(true);
    expect(tooLongChange.success).toBe(false);
  });

  it("trims email and session name properly", () => {
    const loginResult = loginSchema.safeParse({
      email: "  user@example.com  ",
      password: "1",
    });
    const renameResult = updateSessionNameSchema.safeParse({
      name: "  جهاز العمل  ",
    });
    const emptyRename = updateSessionNameSchema.safeParse({
      name: "   ",
    });

    expect(loginResult.success).toBe(true);
    if (loginResult.success) {
      expect(loginResult.data.email).toBe("user@example.com");
    }

    expect(renameResult.success).toBe(true);
    if (renameResult.success) {
      expect(renameResult.data.name).toBe("جهاز العمل");
    }

    expect(emptyRename.success).toBe(false);
  });

  it("detects MAX_SESSIONS_REACHED payloads safely", () => {
    expect(
      isMaxSessionsReachedResponse({
        error: "MAX_SESSIONS_REACHED",
        message: "Limit exceeded",
        sessions: [],
      }),
    ).toBe(true);

    expect(
      isMaxSessionsReachedResponse({
        error: "INVALID_CREDENTIALS",
        sessions: [],
      }),
    ).toBe(false);

    expect(isMaxSessionsReachedResponse(null)).toBe(false);
  });
});
