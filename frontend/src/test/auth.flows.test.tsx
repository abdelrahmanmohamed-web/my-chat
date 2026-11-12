import { fireEvent, screen, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { useAuthStore } from "@/stores";
import {
  TEST_ACCESS_TOKEN,
  TEST_SESSIONS,
  TEST_USER,
} from "@/test/msw/fixtures";
import { mswServer } from "@/test/msw/server";
import { renderAppAt } from "@/test/render-app";

describe("Phase 1 auth flows", () => {
  it("restores session on initial load when refresh succeeds", async () => {
    const { router } = renderAppAt("/");

    expect(await screen.findByText("مرحباً، أحمد محمد")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(useAuthStore.getState().status).toBe("authenticated");
  });

  it("redirects unauthenticated user to /login and returns to intended route after login", async () => {
    mswServer.use(
      http.post("*/api/auth/refresh", () =>
        HttpResponse.json({ error: "NO_SESSION" }, { status: 401 }),
      ),
    );

    const { router } = renderAppAt("/settings/security");

    expect(await screen.findByText("تسجيل الدخول")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/login");

    fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), {
      target: { value: "ahmed@example.com" },
    });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), {
      target: { value: "secret1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));

    expect(
      await screen.findByRole("heading", { name: "الأمان والجلسات" }),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/settings/security");
  });

  it("validates 6-char password & Arabic username on register, submits, and prefills login email", async () => {
    let registerCalls = 0;

    mswServer.use(
      http.post("*/api/auth/refresh", () =>
        HttpResponse.json({ error: "NO_SESSION" }, { status: 401 }),
      ),
      http.post("*/api/auth/register", async ({ request }) => {
        registerCalls += 1;
        const body = (await request.json()) as {
          username: string;
          email: string;
        };
        return HttpResponse.json(
          {
            user: {
              ...TEST_USER,
              username: body.username,
              email: body.email,
            },
          },
          { status: 201 },
        );
      }),
    );

    const { router } = renderAppAt("/register");

    expect(await screen.findByText("إنشاء حساب جديد")).toBeInTheDocument();
    expect(screen.getByText(/كلما زاد الطول زاد الأمان/)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("الاسم الظاهر"), {
      target: { value: "أحمد محمد" },
    });
    fireEvent.change(screen.getByLabelText("اسم المستخدم"), {
      target: { value: "أحمد_2026" },
    });
    fireEvent.change(screen.getByLabelText("البريد الإلكتروني"), {
      target: { value: "ahmed@example.com" },
    });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), {
      target: { value: "12345" },
    });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء الحساب" }));

    expect(
      await screen.findByText("كلمة المرور يجب أن تكون 6 حرفاً على الأقل"),
    ).toBeInTheDocument();
    expect(registerCalls).toBe(0);

    fireEvent.change(screen.getByLabelText("كلمة المرور"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "إنشاء الحساب" }));

    expect(
      await screen.findByRole("button", { name: "دخول" }),
    ).toBeInTheDocument();
    expect(screen.getByText("تسجيل الدخول")).toBeInTheDocument();
    expect(registerCalls).toBe(1);
    expect(router.state.location.pathname).toBe("/login");
    expect(screen.getByLabelText("البريد الإلكتروني")).toHaveValue(
      "ahmed@example.com",
    );
  });

  it("handles 409 max-sessions conflict by revoking selected session and logging in", async () => {
    const sentPayloads: Array<{ revokeSessionId?: string }> = [];

    mswServer.use(
      http.post("*/api/auth/refresh", () =>
        HttpResponse.json({ error: "NO_SESSION" }, { status: 401 }),
      ),
      http.post("*/api/auth/login", async ({ request }) => {
        const body = (await request.json()) as { revokeSessionId?: string };
        sentPayloads.push(body);

        if (!body.revokeSessionId) {
          return HttpResponse.json(
            {
              error: "MAX_SESSIONS_REACHED",
              message: "Max sessions reached",
              sessions: TEST_SESSIONS,
            },
            { status: 409 },
          );
        }

        return HttpResponse.json({
          accessToken: TEST_ACCESS_TOKEN,
          user: TEST_USER,
        });
      }),
    );

    renderAppAt("/login");

    fireEvent.change(await screen.findByLabelText("البريد الإلكتروني"), {
      target: { value: "ahmed@example.com" },
    });
    fireEvent.change(screen.getByLabelText("كلمة المرور"), {
      target: { value: "123456" },
    });
    fireEvent.click(screen.getByRole("button", { name: "دخول" }));

    expect(
      await screen.findByText("تم الوصول للحد الأقصى للجلسات النشطة"),
    ).toBeInTheDocument();

    const revokeButtons = screen.getAllByRole("button", {
      name: "إنهاء الجلسة",
    });
    fireEvent.click(revokeButtons[0]);

    expect(await screen.findByText("مرحباً، أحمد محمد")).toBeInTheDocument();
    expect(sentPayloads).toEqual([
      { email: "ahmed@example.com", password: "123456" },
      {
        email: "ahmed@example.com",
        password: "123456",
        revokeSessionId: TEST_SESSIONS[0].id,
      },
    ]);
  });

  it("supports RTL inputs, session rename/revoke, password change, and logout on security settings", async () => {
    let sessions = [...TEST_SESSIONS];
    let changePasswordBody: {
      currentPassword?: string;
      newPassword?: string;
    } | null = null;
    let logoutCalled = false;

    mswServer.use(
      http.get("*/api/sessions", () => HttpResponse.json({ sessions })),
      http.patch("*/api/sessions/:sessionId", async ({ params, request }) => {
        const body = (await request.json()) as { name: string };
        sessions = sessions.map((item) =>
          item.id === params.sessionId ? { ...item, name: body.name } : item,
        );
        const updated = sessions.find((item) => item.id === params.sessionId);
        return HttpResponse.json({ session: updated });
      }),
      http.delete("*/api/sessions/:sessionId", ({ params }) => {
        sessions = sessions.filter((item) => item.id !== params.sessionId);
        return HttpResponse.json({ message: "Session revoked" });
      }),
      http.post("*/api/auth/change-password", async ({ request }) => {
        changePasswordBody = (await request.json()) as {
          currentPassword: string;
          newPassword: string;
        };
        return HttpResponse.json({ message: "Password updated" });
      }),
      http.post("*/api/auth/logout", () => {
        logoutCalled = true;
        return HttpResponse.json({ message: "Logged out" });
      }),
    );

    const { router } = renderAppAt("/settings/security");

    expect(await screen.findByText("المتصفح الحالي")).toBeInTheDocument();
    expect(screen.getByText("هاتف العمل")).toBeInTheDocument();

    const renameButtons = screen.getAllByRole("button", {
      name: "إعادة تسمية",
    });
    fireEvent.click(renameButtons[0]);

    const renameInput = screen.getByLabelText("اسم الجلسة");
    expect(renameInput).toHaveAttribute("dir", "rtl");
    fireEvent.change(renameInput, { target: { value: "لابتوب المنزل" } });
    fireEvent.click(screen.getByRole("button", { name: "حفظ اسم الجلسة" }));

    expect(await screen.findByText("لابتوب المنزل")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "إنهاء" }));
    await waitFor(() => {
      expect(screen.queryByText("هاتف العمل")).not.toBeInTheDocument();
    });

    const currentPasswordInput = screen.getByLabelText("كلمة المرور الحالية");
    const newPasswordInput = screen.getByLabelText("كلمة المرور الجديدة");
    expect(currentPasswordInput).toHaveAttribute("dir", "rtl");
    expect(newPasswordInput).toHaveAttribute("dir", "rtl");
    expect(screen.getByText(/كلما زاد الطول زاد الأمان/)).toBeInTheDocument();

    fireEvent.change(currentPasswordInput, { target: { value: "old123" } });
    fireEvent.change(newPasswordInput, { target: { value: "new123" } });
    fireEvent.click(screen.getByRole("button", { name: "تحديث كلمة المرور" }));

    await waitFor(() => {
      expect(changePasswordBody).toEqual({
        currentPassword: "old123",
        newPassword: "new123",
      });
    });

    fireEvent.click(screen.getByRole("button", { name: "تسجيل الخروج" }));

    expect(await screen.findByText("تسجيل الدخول")).toBeInTheDocument();
    expect(logoutCalled).toBe(true);
    expect(useAuthStore.getState().status).toBe("unauthenticated");
    expect(router.state.location.pathname).toBe("/login");
  });

  it("logs out centrally and redirects to /login on forced 401 when refresh fails", async () => {
    let sessionsRequestCount = 0;

    mswServer.use(
      http.get("*/api/sessions", () => {
        sessionsRequestCount += 1;
        if (sessionsRequestCount === 1) {
          return HttpResponse.json({ sessions: TEST_SESSIONS });
        }
        return HttpResponse.json({ error: "SESSION_REVOKED" }, { status: 401 });
      }),
    );

    const { router } = renderAppAt("/settings/security");
    expect(await screen.findByText("المتصفح الحالي")).toBeInTheDocument();

    mswServer.use(
      http.post("*/api/auth/refresh", () =>
        HttpResponse.json({ error: "SESSION_REVOKED" }, { status: 401 }),
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "تحديث قائمة الجلسات" }),
    );

    expect(await screen.findByText("تسجيل الدخول")).toBeInTheDocument();
    expect(useAuthStore.getState().status).toBe("unauthenticated");
    expect(router.state.location.pathname).toBe("/login");
  });
});
