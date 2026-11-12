export const ROUTES = {
  home: "/",
  login: "/login",
  register: "/register",
  settingsSecurity: "/settings/security",
} as const;

const AUTH_PUBLIC_ROUTES: ReadonlyArray<string> = [
  ROUTES.login,
  ROUTES.register,
];

interface LocationStateLike {
  from?: {
    pathname?: string;
    search?: string;
    hash?: string;
  };
}

/**
 * Extracts a safe internal redirect path preserved by ProtectedRoute before login.
 */
export function getRedirectTarget(state: unknown): string {
  if (typeof state !== "object" || state === null) {
    return ROUTES.home;
  }

  const from = (state as LocationStateLike).from;
  if (!from || typeof from.pathname !== "string") {
    return ROUTES.home;
  }

  const candidate = `${from.pathname}${from.search ?? ""}${from.hash ?? ""}`;
  if (
    !candidate.startsWith("/") ||
    AUTH_PUBLIC_ROUTES.includes(from.pathname)
  ) {
    return ROUTES.home;
  }

  return candidate;
}
