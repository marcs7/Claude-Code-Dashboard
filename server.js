const express = require('express');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 8502;

// Security headers — HSTS + upgrade-insecure-requests only when behind HTTPS proxy
const forceHttps = process.env.FORCE_HTTPS === 'true';
app.use(helmet({
  hsts: forceHttps,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      scriptSrcAttr: ["'unsafe-inline'"],
      upgradeInsecureRequests: forceHttps ? [] : null
    }
  }
}));

// Compression
app.use(compression());

// Middleware
app.use(express.json({ limit: '100kb' }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(JSON.stringify({ timestamp: new Date().toISOString(), method: req.method, path: req.originalUrl, status: res.statusCode, duration }));
  });
  next();
});

// Static files with 1-hour cache
app.use(express.static(path.join(__dirname, 'src', 'public'), { maxAge: '1h' }));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));

// Rate limiting for DELETE routes: max 30 per minute per IP
const deleteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many delete requests, please try again later' }
});
app.delete('*', deleteLimiter);

// Cache-Control: no-store for all API responses
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Routes
const pagesRouter = require('./src/routes/pages');
const apiRouter = require('./src/routes/api');

app.use('/', pagesRouter);
app.use('/api', apiRouter);

// 404 handler for unknown routes
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.status(404).render('404', { title: 'Not Found' });
});

// Global error handler — never leak stack traces in production
app.use((err, req, res, _next) => {
  console.error(JSON.stringify({ timestamp: new Date().toISOString(), level: 'error', message: err.message, path: req.originalUrl }));
  if (process.env.NODE_ENV !== 'production') {
    console.error(err.stack);
  }
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Internal Server Error' });
  }
  res.status(500).send('Internal Server Error');
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`CC Dashboard running on port ${PORT}`);
});

// Graceful shutdown
function shutdown(signal) {
  console.log(`\n[${new Date().toISOString()}] Received ${signal}. Shutting down...`);
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
  setTimeout(() => {
    console.log('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
