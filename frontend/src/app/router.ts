import { createElement, lazy, Suspense, type ComponentType } from "react";
import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { Spinner } from "@/components/ui/spinner";
import { ProtectedRoute, PublicOnlyRoute } from "./route-guards";
import { ROUTES } from "./routes";

export function RouteLoadingFallback() {
  return createElement(
    "div",
    {
      role: "status",
      "aria-live": "polite",
      className:
        "flex min-h-screen w-full items-center justify-center bg-background",
    },
    createElement(Spinner, { className: "size-8 text-primary" }),
    createElement("span", { className: "sr-only" }, "جاري التحميل..."),
  );
}

function withSuspense(Component: ComponentType) {
  return createElement(
    Suspense,
    { fallback: createElement(RouteLoadingFallback) },
    createElement(Component),
  );
}

const LazyLoginPage = lazy(() =>
  import("@/features/auth/pages/LoginPage").then((module) => ({
    default: module.LoginPage,
  })),
);

const LazyRegisterPage = lazy(() =>
  import("@/features/auth/pages/RegisterPage").then((module) => ({
    default: module.RegisterPage,
  })),
);

const LazySecuritySettingsPage = lazy(() =>
  import("@/features/auth/pages/SecuritySettingsPage").then((module) => ({
    default: module.SecuritySettingsPage,
  })),
);

const LazyChatWorkspacePage = lazy(() =>
  import("@/features/chat/pages/ChatWorkspacePage").then((module) => ({
    default: module.ChatWorkspacePage,
  })),
);

export interface RouteComponentsMap {
  login: ComponentType;
  register: ComponentType;
  settingsSecurity: ComponentType;
  chatWorkspace: ComponentType;
}

export function buildAppRoutes(
  components?: Partial<RouteComponentsMap>,
): RouteObject[] {
  const loginElement = components?.login
    ? createElement(components.login)
    : withSuspense(LazyLoginPage);

  const registerElement = components?.register
    ? createElement(components.register)
    : withSuspense(LazyRegisterPage);

  const chatWorkspaceElement = components?.chatWorkspace
    ? createElement(components.chatWorkspace)
    : withSuspense(LazyChatWorkspacePage);

  const settingsSecurityElement = components?.settingsSecurity
    ? createElement(components.settingsSecurity)
    : withSuspense(LazySecuritySettingsPage);

  return [
    {
      element: createElement(PublicOnlyRoute),
      children: [
        {
          path: ROUTES.login,
          element: loginElement,
        },
        {
          path: ROUTES.register,
          element: registerElement,
        },
      ],
    },
    {
      element: createElement(ProtectedRoute),
      children: [
        {
          path: ROUTES.home,
          element: chatWorkspaceElement,
        },
        {
          path: ROUTES.chat,
          element: chatWorkspaceElement,
        },
        {
          path: ROUTES.settingsSecurity,
          element: settingsSecurityElement,
        },
      ],
    },
    {
      path: "*",
      element: createElement(Navigate, { to: ROUTES.home, replace: true }),
    },
  ];
}

export const appRoutes: RouteObject[] = buildAppRoutes();

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
