import { createElement } from "react";
import { createBrowserRouter, Navigate, type RouteObject } from "react-router";
import { ProtectedRoute, PublicOnlyRoute } from "./route-guards";
import {
  HomeRoutePlaceholder,
  LoginRoutePlaceholder,
  RegisterRoutePlaceholder,
  SecuritySettingsPlaceholder,
} from "./route-placeholders";
import { ROUTES } from "./routes";

export const appRoutes: RouteObject[] = [
  {
    element: createElement(PublicOnlyRoute),
    children: [
      {
        path: ROUTES.login,
        element: createElement(LoginRoutePlaceholder),
      },
      {
        path: ROUTES.register,
        element: createElement(RegisterRoutePlaceholder),
      },
    ],
  },
  {
    element: createElement(ProtectedRoute),
    children: [
      {
        path: ROUTES.home,
        element: createElement(HomeRoutePlaceholder),
      },
      {
        path: ROUTES.settingsSecurity,
        element: createElement(SecuritySettingsPlaceholder),
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
