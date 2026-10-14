import { cache } from "react";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { ACCESS_COOKIE } from "./constants";
import { verifyAccessToken } from "./tokens";
import type { AuthUser } from "./user";

/**
 * The signed-in user for the current page request, or null. Server components only: this uses
 * next/headers, which the API code deliberately avoids. The role is re-read from the database;
 * `cache` only de-duplicates the lookup within one request, nothing is shared between users.
 */
export const getSessionUser = cache(async (): Promise<AuthUser | null> => {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  const userId = await verifyAccessToken(token);
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, fullName: true, role: true, isActive: true },
  });
  if (!user || !user.isActive) return null;
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
});
