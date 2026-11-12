import { createElement } from "react";
import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { LoginPage, RegisterPage, SecuritySettingsPage } from "@/features/auth";
import { ChatWorkspacePage } from "@/features/chat";
import { ProtectedRoute, PublicOnlyRoute } from "./route-guards";
import { ROUTES } from "./routes";

export const appRoutes: RouteObject[] = [
  {
    element: createElement(PublicOnlyRoute),
    children: [
      {
        path: ROUTES.login,
        element: createElement(LoginPage),
      },
      {
        path: ROUTES.register,
        element: createElement(RegisterPage),
      },
    ],
  },
  {
    element: createElement(ProtectedRoute),
    children: [
      {
        path: ROUTES.home,
        element: createElement(ChatWorkspacePage),
      },
      {
        path: ROUTES.chat,
        element: createElement(ChatWorkspacePage),
      },
      {
        path: ROUTES.settingsSecurity,
        element: createElement(SecuritySettingsPage),
      },
    ],
  },
  {
    path: "*",
    element: createElement(Navigate, { to: ROUTES.home, replace: true }),
  },
];

export function createAppRouter() {
  return createBrowserRouter(appRoutes);
}
