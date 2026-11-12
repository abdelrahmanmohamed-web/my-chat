import { Navigate, Outlet, useLocation } from "react-router";
import { Spinner } from "@/components/ui/spinner";
import { useAuthStore } from "@/stores";
import { getRedirectTarget, ROUTES } from "./routes";

function RouteCheckingFallback() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-dvh items-center justify-center bg-app-canvas p-6"
    >
      <Spinner
        className="size-6 text-primary"
        aria-label="جاري التحقق من الجلسة"
      />
    </div>
  );
}

/**
 * Guards authenticated routes and preserves the attempted URL for post-login redirect.
 */
export function ProtectedRoute() {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();

  if (status === "checking") {
    return <RouteCheckingFallback />;
  }

  if (status === "unauthenticated") {
    return <Navigate to={ROUTES.login} replace state={{ from: location }} />;
  }

  return <Outlet />;
}

/**
 * Prevents authenticated users from accessing guest-only pages like login/register.
 */
export function PublicOnlyRoute() {
  const status = useAuthStore((state) => state.status);
  const location = useLocation();

  if (status === "checking") {
    return <RouteCheckingFallback />;
  }

  if (status === "authenticated") {
    const target = getRedirectTarget(location.state);
    return <Navigate to={target} replace />;
  }

  return <Outlet />;
}
