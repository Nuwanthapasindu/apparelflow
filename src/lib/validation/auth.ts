import { z } from "zod";

export const MAX_EMAIL_LENGTH = 254;
export const MAX_PASSWORD_LENGTH = 128;

/** Strict: any extra key is a 400. Email is trimmed and lowercased before lookup. */
export const loginSchema = z.strictObject({
  email: z.string().trim().toLowerCase().min(1, "Email is required").max(MAX_EMAIL_LENGTH, "Email is too long"),
  password: z.string().min(1, "Password is required").max(MAX_PASSWORD_LENGTH, "Password is too long"),
});
