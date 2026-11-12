import { render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AppProviders } from "@/app/providers";
import { appRoutes } from "@/app/router";

export function renderAppAt(initialRoute = "/") {
  const router = createMemoryRouter(appRoutes, {
    initialEntries: [initialRoute],
  });

  const view = render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );

  return {
    router,
    ...view,
  };
}
