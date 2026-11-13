import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { VirtuosoMockContext } from "react-virtuoso";
import { AppProviders } from "@/app/providers";
import { buildAppRoutes } from "@/app/router";
import { LoginPage, RegisterPage, SecuritySettingsPage } from "@/features/auth";
import { ChatWorkspacePage } from "@/features/chat";
import type { RealtimeSocket } from "@/lib/socket";
import { createFakeRealtimeSocket } from "./fake-socket";

export const eagerAppRoutes = buildAppRoutes({
  login: LoginPage,
  register: RegisterPage,
  settingsSecurity: SecuritySettingsPage,
  chatWorkspace: ChatWorkspacePage,
});

interface RenderAppOptions {
  socketInstance?: RealtimeSocket;
}

export function renderAppAt(initialRoute = "/", options?: RenderAppOptions) {
  const socketInstance = options?.socketInstance ?? createFakeRealtimeSocket();
  const router = createMemoryRouter(eagerAppRoutes, {
    initialEntries: [initialRoute],
  });

  const view = render(
    <VirtuosoMockContext.Provider
      value={{ viewportHeight: 600, itemHeight: 80 }}
    >
      <AppProviders socketInstance={socketInstance}>
        <RouterProvider router={router} />
      </AppProviders>
    </VirtuosoMockContext.Provider>,
  );

  return {
    router,
    socketInstance,
    ...view,
  };
}
