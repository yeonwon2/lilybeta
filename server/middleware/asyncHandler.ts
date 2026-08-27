import type { RequestHandler } from 'express';

// Express 4 does not forward rejected route promises to error middleware.
export const asyncHandler = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve().then(() => handler(req, res, next)).catch(next);
};
