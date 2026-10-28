/** Handles credential validation and sign-in responses. */

import { Router } from "express";

import { login } from "../../services/auth/auth-service.ts";
import { credentialsSchema } from "../../validators/auth-schemas.ts";

export const loginRouter = Router();

loginRouter.post("/login", async (req, res) => {
  const parsed = credentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid email or password" });
  }

  const userAgent = req.get("user-agent") ?? "Unknown device";
  const tokens = await login(parsed.data, {
    device: parsed.data.device ?? userAgent,
    ip: req.ip ?? "unknown",
    userAgent,
  });
  if (!tokens)
    return res.status(401).json({ error: "Invalid email or password" });
  return res.json(tokens);
});
