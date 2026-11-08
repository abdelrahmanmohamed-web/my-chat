import { z } from "zod";

export const registerSchema = z.object({
  email: z.string().trim().email().max(254),
  username: z
    .string()
    .trim()
    .min(3)
    .max(32)
    .regex(/^[a-zA-Z0-9_]+$/),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(15).max(128),
});

export const credentialsSchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(128),
  device: z.string().trim().min(1).max(120).optional(),
  name: z.string().trim().min(1).max(100).optional(),
  revokeSessionId: z.string().trim().optional(),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: z.string().min(15).max(128),
});

export const updateSessionNameSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export type RegistrationInput = z.infer<typeof registerSchema>;
export type CredentialsInput = z.infer<typeof credentialsSchema>;
