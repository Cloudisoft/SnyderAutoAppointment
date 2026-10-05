import pino from 'pino';

export type Logger = pino.Logger;

export function createLogger(level = process.env.LOG_LEVEL ?? 'info'): Logger {
  return pino({
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers["x-vapi-secret"]',
        '*.password',
        '*.authToken',
        '*.token',
      ],
      censor: '[redacted]',
    },
  });
}
