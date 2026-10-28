/**
 * Authentication service facade.
 * Routes import this file while each use case remains in a focused module.
 */
export { changePassword, getUserProfile } from "./account-service.ts";
export { login } from "./login-service.ts";
export { register } from "./registration-service.ts";
export {
  logout,
  logoutByRefreshToken,
  rotateRefreshToken,
  type RefreshResult,
} from "./refresh-service.ts";
