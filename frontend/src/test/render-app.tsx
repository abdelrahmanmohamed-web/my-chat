import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { VirtuosoMockContext } from "react-virtuoso";
import { AppProviders } from "@/app/providers";
import { appRoutes } from "@/app/router";

export function renderAppAt(initialRoute = "/") {
  const router = createMemoryRouter(appRoutes, {
    initialEntries: [initialRoute],
  });

  const view = render(
    <VirtuosoMockContext.Provider
      value={{ viewportHeight: 600, itemHeight: 80 }}
    >
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    </VirtuosoMockContext.Provider>,
  );

  return {
    router,
    ...view,
  };
}
