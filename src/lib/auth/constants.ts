export const ACCESS_COOKIE = "af_access";
export const REFRESH_COOKIE = "af_refresh";
export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60;
export const JWT_ISSUER = "apparelflow";
// Access cookie is sent everywhere; the refresh cookie only ever goes to the auth endpoints.
export const ACCESS_COOKIE_PATH = "/";
export const REFRESH_COOKIE_PATH = "/api/auth";
