const winston = require('winston');

function createLogger({ env = 'development', level = 'info' } = {}) {
  const isTest = env === 'test';
  const structured = env === 'production';

  const format = structured
    ? winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      )
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp({ format: 'HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ level: lvl, message, timestamp, ...meta }) => {
          const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} ${lvl} ${message}${extra}`;
        })
      );

  return winston.createLogger({
    level,
    format,
    silent: isTest,
    transports: [
      new winston.transports.Console({
        stderrLevels: ['error']
      })
    ]
  });
}

module.exports = { createLogger };
