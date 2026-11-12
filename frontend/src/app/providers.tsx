import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { DirectionProvider } from "@/components/ui/direction";
import { Toaster } from "@/components/ui/sonner";
import { queryClient } from "./query-client";
import { SessionBootstrap } from "./session-bootstrap";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <DirectionProvider direction="rtl">
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <QueryClientProvider client={queryClient}>
          <SessionBootstrap>{children}</SessionBootstrap>
          <Toaster dir="rtl" position="top-center" richColors />
        </QueryClientProvider>
      </ThemeProvider>
    </DirectionProvider>
  );
}
