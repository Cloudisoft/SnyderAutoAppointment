export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export const notFound = (message = 'Not found') => new HttpError(404, message, 'not_found');
export const badRequest = (message: string, code = 'bad_request') => new HttpError(400, message, code);
export const forbidden = (message = 'Forbidden') => new HttpError(403, message, 'forbidden');
export const unauthorized = (message = 'Unauthorized') => new HttpError(401, message, 'unauthorized');
export const conflict = (message: string, code = 'conflict') => new HttpError(409, message, code);
