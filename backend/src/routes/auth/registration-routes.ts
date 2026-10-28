/** Handles account registration requests and duplicate-account responses. */

import { Router } from "express";

import { register } from "../../services/auth/auth-service.ts";
import { registerSchema } from "../../validators/auth-schemas.ts";

export const registrationRouter = Router();

registrationRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid registration details" });
  }

  try {
    const user = await register(parsed.data);
    return res.status(201).json({ user });
  } catch (error) {
    // MongoDB uses code 11000 when a unique email or username already exists.
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === 11000
    ) {
      return res
        .status(409)
        .json({ error: "Email or username is already in use" });
    }
    throw error;
  }
});
