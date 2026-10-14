// Read lazily, inside functions: a module-level throw would break `next build` on CI,
// where the secrets are not present.

const MIN_JWT_SECRET_LENGTH = 32;

export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET must be set and at least ${MIN_JWT_SECRET_LENGTH} characters long`);
  }
  return secret;
}

export function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}
