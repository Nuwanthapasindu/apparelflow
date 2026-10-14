// Only these keys are accepted from the URL (?reason=), so the query string cannot inject text into
// the page. Own-property lookup only: `reason=toString` or `constructor` must not reach inherited members.
const NOTICES: Record<string, string> = {
  "switch-failed": "You were signed out, but signing in as the other role failed. Please sign in again.",
};

export function noticeFor(reason: string | string[] | undefined): string | undefined {
  return typeof reason === "string" && Object.hasOwn(NOTICES, reason) ? NOTICES[reason] : undefined;
}
