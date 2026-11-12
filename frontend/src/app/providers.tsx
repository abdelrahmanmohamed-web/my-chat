import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { DirectionProvider } from "@/components/ui/direction";
import { Toaster } from "@/components/ui/sonner";
import { RealtimeProvider } from "@/features/connection";
import type { RealtimeSocket } from "@/lib/socket";
import { queryClient } from "./query-client";
import { SessionBootstrap } from "./session-bootstrap";

interface AppProvidersProps {
  children: ReactNode;
  socketInstance?: RealtimeSocket;
}

export function AppProviders({ children, socketInstance }: AppProvidersProps) {
  return (
    <DirectionProvider direction="rtl">
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <QueryClientProvider client={queryClient}>
          <SessionBootstrap>
            <RealtimeProvider socketInstance={socketInstance}>
              {children}
            </RealtimeProvider>
          </SessionBootstrap>
          <Toaster dir="rtl" position="top-center" richColors />
        </QueryClientProvider>
      </ThemeProvider>
    </DirectionProvider>
  );
}
