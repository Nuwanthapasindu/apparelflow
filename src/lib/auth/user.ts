import type { Role } from "@/generated/prisma/client";

/** The only user shape that ever leaves the server. Never add hashes or tokens here. */
export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  role: Role;
};

export function toUserDto(user: AuthUser): AuthUser {
  return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
}
