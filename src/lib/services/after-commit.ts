/**
 * Reads the response body after a transaction has committed. The write already succeeded, so one
 * retry covers a transient network error; without it the caller would see a 500 for a change that
 * took effect (and for an order creation, a retry from the client would create a duplicate).
 */
export async function readAfterCommit<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch {
    return read();
  }
}
