/** Central registration point for authentication-related HTTP routes. */

import { Router } from "express";

import { accountRouter } from "./account-routes.ts";
import { loginRouter } from "./login-routes.ts";
import { logoutRouter } from "./logout-routes.ts";
import { registrationRouter } from "./registration-routes.ts";
import { tokenRouter } from "./token-routes.ts";

export const authRouter = Router();
authRouter.use(registrationRouter);
authRouter.use(loginRouter);
authRouter.use(tokenRouter);
authRouter.use(logoutRouter);
authRouter.use(accountRouter);
