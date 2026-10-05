/** Errors that are safe to show to users. Anything else becomes a generic 500. */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new AppError(400, "bad_request", msg, details);
export const unauthorized = () => new AppError(401, "unauthorized", "Please sign in to continue.");
export const forbidden = (msg = "You don't have access to this.") => new AppError(403, "forbidden", msg);
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found.`);
export const conflict = (msg: string) => new AppError(409, "conflict", msg);
export const limitReached = (msg: string) => new AppError(402, "limit_reached", msg);
export const tooMany = (retryAfter: number) =>
  new AppError(429, "rate_limited", `Slow down a little — try again in ${retryAfter}s.`, { retryAfter });
