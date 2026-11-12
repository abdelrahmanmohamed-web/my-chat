import { RouterProvider } from "react-router";
import { AppProviders } from "./providers";
import { createAppRouter } from "./router";

const appRouter = createAppRouter();

export function App() {
  return (
    <AppProviders>
      <RouterProvider router={appRouter} />
    </AppProviders>
  );
}
