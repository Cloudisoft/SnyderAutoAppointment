import type { FastifyInstance } from 'fastify';
import { TimeoutError, UpstreamError } from '../lib/http';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors';

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'validation_error', message: validationMessage(err), issues: err.issues });
    }
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({ error: err.code ?? 'error', message: err.message });
    }
    if (err instanceof UpstreamError) {
      req.log.warn({ err }, 'upstream error');
      return reply.status(502).send({ error: 'upstream_error', message: err.userMessage });
    }
    if (err instanceof TimeoutError) {
      req.log.warn({ err }, 'upstream timeout');
      return reply.status(504).send({ error: 'timeout', message: err.message });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status && status < 500) {
      return reply.status(status).send({ error: 'error', message: (err as Error).message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: 'internal_error', message: 'Something went wrong' });
  });
}

/** One readable sentence for the UI, e.g. "transfer_number: Transfer number is not a valid phone number". */
export function validationMessage(err: ZodError): string {
  const parts = err.issues.slice(0, 3).map((i) => (i.path.length ? `${i.path.join('.')}: ${i.message}` : i.message));
  return parts.join('; ') || 'Some fields are invalid';
}
