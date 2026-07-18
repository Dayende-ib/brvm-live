const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const winston = require('winston');
const { z } = require('zod');
const coursHandler = require('./cours');

// Logger Winston
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    new winston.transports.File({ filename: 'logs/combined.log' }),
    new winston.transports.Console({
      format: winston.format.simple()
    })
  ]
});

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per windowMs
  message: { erreur: 'Trop de requêtes, réessayez plus tard.' },
  standardHeaders: true,
  legacyHeaders: false
});

app.use(limiter);

// CORS
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
  methods: ['GET'],
  allowedHeaders: ['Content-Type']
}));

app.use(express.json({ limit: '10kb' }));

// Validation schema with Zod
const coursQuerySchema = z.object({
  symbole: z.string().max(10).optional().transform(val => val ? val.trim().toUpperCase() : undefined),
  format: z.enum(['json', 'csv']).optional().default('json')
});

// API route with validation and logging
app.get('/api/cours', async (req, res) => {
  const startTime = Date.now();
  
  try {
    // Validate query parameters
    const validatedQuery = coursQuerySchema.parse(req.query);
    req.query = validatedQuery;
    
    logger.info('API request', {
      endpoint: '/api/cours',
      query: validatedQuery,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    
    await coursHandler(req, res);
    
    const duration = Date.now() - startTime;
    logger.info('API response', {
      endpoint: '/api/cours',
      status: res.statusCode,
      duration: `${duration}ms`
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Validation error', {
        endpoint: '/api/cours',
        errors: error.errors,
        ip: req.ip
      });
      return res.status(400).json({
        erreur: 'Paramètres invalides',
        details: error.errors
      });
    }
    
    logger.error('API error', {
      endpoint: '/api/cours',
      error: error.message,
      stack: error.stack,
      ip: req.ip
    });
    
    return res.status(500).json({
      erreur: 'Erreur serveur interne'
    });
  }
});

// Root endpoint
app.get('/', (req, res) => {
  logger.info('Root endpoint accessed', { ip: req.ip });
  res.json({
    message: 'BRVM Live API',
    version: '1.0.0',
    endpoints: {
      '/api/cours': {
        en: 'Get all stocks (JSON)',
        fr: 'Récupérer toutes les actions (JSON)'
      },
      '/api/cours?symbole=ONTBF': {
        en: 'Get single stock by symbol',
        fr: 'Récupérer une action par son symbole'
      },
      '/api/cours?format=csv': {
        en: 'Get all stocks in CSV format',
        fr: 'Récupérer toutes les actions (CSV)'
      }
    },
    security: {
      rateLimit: {
        en: '100 requests per 15 minutes',
        fr: '100 requêtes par 15 minutes'
      },
      headers: {
        en: 'Helmet enabled',
        fr: 'Helmet activé'
      },
      logging: {
        en: 'Winston enabled',
        fr: 'Winston activé'
      }
    }
  });
});

// 404 handler
app.use((req, res) => {
  // Ignore common automatic requests (service workers, favicons, etc.)
  const ignoredPaths = ['/sw.js', '/service-worker.js', '/favicon.ico', '/robots.txt'];
  if (ignoredPaths.includes(req.path)) {
    return res.status(404).send();
  }
  
  logger.warn('404 Not Found', {
    path: req.path,
    method: req.method,
    ip: req.ip
  });
  res.status(404).json({ erreur: 'Endpoint non trouvé' });
});

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    ip: req.ip
  });
  res.status(500).json({ erreur: 'Erreur serveur interne' });
});

// Start server
app.listen(PORT, () => {
  logger.info(`BRVM Live API started on port ${PORT}`);
  console.log(`BRVM Live API running on port ${PORT}`);
  console.log(`Access at http://localhost:${PORT}`);
});
