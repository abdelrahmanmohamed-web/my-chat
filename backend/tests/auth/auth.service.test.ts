import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import argon2 from "argon2";
import mongoose from "mongoose";
import {
  register,
  login,
  logout,
  getUserProfile,
  changePassword,
  toPublicUser,
} from "../../src/modules/auth/auth.service.ts";
import { User } from "../../src/modules/users/user.model.ts";
import { Session } from "../../src/modules/auth/sessions/session.model.ts";
import { connectTestDB, disconnectTestDB, clearTestDB } from "../helpers/db.ts";

describe("Auth Service (auth.service.ts)", () => {
  beforeAll(async () => {
    await connectTestDB();
  });

  afterAll(async () => {
    await clearTestDB();
    await disconnectTestDB();
  });

  beforeEach(async () => {
    await clearTestDB();
  });

  describe("toPublicUser", () => {
    it("should transform user to a safe public representation without sensitive fields", () => {
      const publicUser = toPublicUser({
        id: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        displayName: "Test User",
        avatarUrl: "https://example.com/avatar.png",
      });

      expect(publicUser).toEqual({
        id: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        displayName: "Test User",
        avatarUrl: "https://example.com/avatar.png",
      });
      expect(publicUser).not.toHaveProperty("passwordHash");
    });

    it("should omit avatarUrl property if it is undefined", () => {
      const publicUser = toPublicUser({
        id: "507f1f77bcf86cd799439011",
        email: "test@example.com",
        username: "testuser",
        displayName: "Test User",
      });

      expect(publicUser).not.toHaveProperty("avatarUrl");
    });
  });

  describe("register", () => {
    const validRegistration = {
      email: "Ali@Example.com",
      username: "ali_wonder",
      displayName: "Ali W.",
      password: "SuperSecretPassword123!",
    };

    it("should successfully register a new user with Argon2id password hash and lowercase email", async () => {
      const user = await register(validRegistration);

      expect(user).toBeDefined();
      expect(user.id).toBeDefined();
      expect(user.email).toBe("ali@example.com");
      expect(user.username).toBe("ali_wonder");
      expect(user.displayName).toBe("Ali W.");

      // Verify in DB that password is truly hashed with Argon2id
      const dbUser = await User.findById(user.id).select("+passwordHash");
      expect(dbUser).not.toBeNull();
      expect(dbUser?.passwordHash).toBeDefined();
      expect(dbUser?.passwordHash).not.toBe(validRegistration.password);
      expect(
        await argon2.verify(dbUser!.passwordHash, validRegistration.password),
      ).toBe(true);
    });

    it("should throw a duplicate error (code 11000) when email is already taken", async () => {
      await register(validRegistration);

      await expect(
        register({
          email: "ali@example.com", // same email (case variation)
          username: "different_user",
          displayName: "Different",
          password: "SuperSecretPassword123!",
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it("should throw a duplicate error (code 11000) when username is already taken", async () => {
      await register(validRegistration);

      await expect(
        register({
          email: "different@example.com",
          username: "ali_wonder", // same username
          displayName: "Different",
          password: "SuperSecretPassword123!",
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });
  });

  describe("login", () => {
    const registrationData = {
      email: "bob@example.com",
      username: "bob_builder",
      displayName: "Bob B.",
      password: "StrongPassword12345!",
    };

    beforeEach(async () => {
      await register(registrationData);
    });

    it("should return invalid_credentials when user email does not exist", async () => {
      const result = await login(
        { email: "nonexistent@example.com", password: "StrongPassword12345!" },
        { ip: "127.0.0.1", userAgent: "curl/8.4.0" },
      );

      expect(result.status).toBe("invalid_credentials");
    });

    it("should return invalid_credentials when password is incorrect", async () => {
      const result = await login(
        { email: registrationData.email, password: "WrongPassword123!" },
        { ip: "127.0.0.1", userAgent: "curl/8.4.0" },
      );

      expect(result.status).toBe("invalid_credentials");
    });

    it("should authenticate successfully with correct credentials and issue tokens", async () => {
      const result = await login(
        { email: "BOB@EXAMPLE.COM", password: registrationData.password },
        { ip: "10.0.0.1", userAgent: "PostmanRuntime/7.39.0" },
      );

      expect(result.status).toBe("ok");
      if (result.status !== "ok") return;

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(result.tokenType).toBe("Bearer");
      expect(result.expiresIn).toBe(840);
      expect(result.user.email).toBe("bob@example.com");

      // Verify session exists in DB
      const sessionCount = await Session.countDocuments({
        userId: result.user.id,
      });
      expect(sessionCount).toBe(1);
    });

    it("should return max_reached (409 logic) when user reaches max sessions limit (default 3)", async () => {
      // Create 3 active sessions
      const s1 = await login(
        { email: registrationData.email, password: registrationData.password },
        { device: "Dev1" },
      );
      const s2 = await login(
        { email: registrationData.email, password: registrationData.password },
        { device: "Dev2" },
      );
      const s3 = await login(
        { email: registrationData.email, password: registrationData.password },
        { device: "Dev3" },
      );

      expect(s1.status).toBe("ok");
      expect(s2.status).toBe("ok");
      expect(s3.status).toBe("ok");

      // 4th login attempt without revokeSessionId
      const attempt4 = await login(
        {
          email: registrationData.email,
          password: registrationData.password,
          device: "Dev4",
        },
        {},
      );

      expect(attempt4.status).toBe("max_reached");
      if (attempt4.status !== "max_reached") return;

      expect(attempt4.sessions).toHaveLength(3);
    });

    it("should allow 4th login if revokeSessionId is set to a specific session ID", async () => {
      await login(
        { email: registrationData.email, password: registrationData.password },
        { device: "Dev1" },
      );
      await login(
        { email: registrationData.email, password: registrationData.password },
        { device: "Dev2" },
      );
      await login(
        { email: registrationData.email, password: registrationData.password },
        { device: "Dev3" },
      );

      const conflictRes = await login(
        {
          email: registrationData.email,
          password: registrationData.password,
          device: "Dev4",
        },
        {},
      );
      expect(conflictRes.status).toBe("max_reached");
      if (conflictRes.status !== "max_reached") return;

      const targetSessionId = conflictRes.sessions[0].id;

      // Retry with revokeSessionId
      const retryRes = await login(
        {
          email: registrationData.email,
          password: registrationData.password,
          device: "Dev4",
          revokeSessionId: targetSessionId,
        },
        {},
      );

      expect(retryRes.status).toBe("ok");

      // Verify the revoked session no longer exists
      const revoked = await Session.findById(targetSessionId);
      expect(revoked).toBeNull();
    });

    it("should allow 4th login and revoke all sessions if revokeSessionId='all'", async () => {
      await login(
        { email: registrationData.email, password: registrationData.password },
        { device: "Dev1" },
      );
      await login(
        { email: registrationData.email, password: registrationData.password },
        { device: "Dev2" },
      );
      await login(
        { email: registrationData.email, password: registrationData.password },
        { device: "Dev3" },
      );

      const loginAll = await login(
        {
          email: registrationData.email,
          password: registrationData.password,
          device: "DevNew",
          revokeSessionId: "all",
        },
        {},
      );

      expect(loginAll.status).toBe("ok");
      if (loginAll.status !== "ok") return;

      // Only the new session should exist
      const activeSessions = await Session.find({ userId: loginAll.user.id });
      expect(activeSessions).toHaveLength(1);
    });
  });

  describe("logout", () => {
    it("should revoke the specified session", async () => {
      const user = await register({
        email: "logout_user@example.com",
        username: "logout_user",
        displayName: "Logout User",
        password: "Password12345678!",
      });

      const logRes = await login(
        { email: "logout_user@example.com", password: "Password12345678!" },
        {},
      );
      expect(logRes.status).toBe("ok");

      const sessions = await Session.find({ userId: user.id });
      expect(sessions).toHaveLength(1);

      await logout(user.id, sessions[0]._id.toString());

      const afterLogout = await Session.findById(sessions[0]._id);
      expect(afterLogout).toBeNull();
    });
  });

  describe("getUserProfile", () => {
    it("should return the public profile for an existing user", async () => {
      const registered = await register({
        email: "profile_test@example.com",
        username: "profile_test",
        displayName: "Profile Test",
        password: "Password12345678!",
      });

      const profile = await getUserProfile(registered.id);
      expect(profile).not.toBeNull();
      expect(profile?.email).toBe("profile_test@example.com");
      expect(profile?.username).toBe("profile_test");
      expect(profile?.displayName).toBe("Profile Test");
    });

    it("should return null for non-existent user ID", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString();
      const profile = await getUserProfile(fakeId);
      expect(profile).toBeNull();
    });
  });

  describe("changePassword", () => {
    const passwordInitial = "OldPassword123456!";
    const passwordNew = "NewSuperSecretPassword12345!";

    it("should reject password change when currentPassword is wrong", async () => {
      const user = await register({
        email: "change_pw@example.com",
        username: "change_pw",
        displayName: "Change PW",
        password: passwordInitial,
      });

      const fakeSid = new mongoose.Types.ObjectId().toString();
      const changed = await changePassword(
        user.id,
        fakeSid,
        "IncorrectCurrentPassword!",
        passwordNew,
      );
      expect(changed).toBe(false);
    });

    it("should update password, allow login with new password, and invalidate other sessions", async () => {
      const user = await register({
        email: "change_pw2@example.com",
        username: "change_pw2",
        displayName: "Change PW 2",
        password: passwordInitial,
      });

      // Login session 1 (the one changing the password)
      const login1 = await login(
        {
          email: user.email,
          password: passwordInitial,
          name: "Current Session",
        },
        {},
      );
      expect(login1.status).toBe("ok");

      // Login session 2 (another active device)
      const login2 = await login(
        { email: user.email, password: passwordInitial, name: "Other Session" },
        {},
      );
      expect(login2.status).toBe("ok");

      const allSessionsBefore = await Session.find({ userId: user.id });
      expect(allSessionsBefore).toHaveLength(2);

      const currentSid = allSessionsBefore
        .find((s) => s.name === "Current Session")!
        ._id.toString();
      const otherSid = allSessionsBefore
        .find((s) => s.name === "Other Session")!
        ._id.toString();

      // Change password from session 1
      const changed = await changePassword(
        user.id,
        currentSid,
        passwordInitial,
        passwordNew,
      );
      expect(changed).toBe(true);

      // Verify session 2 is revoked while session 1 survives
      const currentSessionAfter = await Session.findById(currentSid);
      const otherSessionAfter = await Session.findById(otherSid);
      expect(currentSessionAfter).not.toBeNull();
      expect(otherSessionAfter).toBeNull();

      // Verify old password fails to login
      const oldLogin = await login(
        { email: user.email, password: passwordInitial },
        {},
      );
      expect(oldLogin.status).toBe("invalid_credentials");

      // Verify new password succeeds
      const newLogin = await login(
        { email: user.email, password: passwordNew },
        {},
      );
      expect(newLogin.status).toBe("ok");
    });
  });
});
