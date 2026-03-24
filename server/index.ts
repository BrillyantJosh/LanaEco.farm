import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, closeDb } from './db/connection.js';
import { startHeartbeat, stopHeartbeat } from './heartbeat.js';
import { createSystemParamsRouter } from './routes/systemParams.js';
import { createUploadsRouter } from './routes/uploads.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.SERVER_PORT || process.env.PORT || 3007;

// CORS
app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:3007',
    'https://www.lanaeco.farm'
  ],
  credentials: true,
}));

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Security headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// Rate limiting
const globalLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 500, standardHeaders: true, legacyHeaders: false });
app.use(globalLimiter);

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.url.includes('/health')) {
      console.log(`${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// Initialize database
const db = getDb();

// Routes
app.use('/api/system-params', createSystemParamsRouter(db));
app.use('/api/uploads', createUploadsRouter());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'lanaeco-farm', timestamp: new Date().toISOString() });
});

// Serve static frontend (production)
const distPath = path.resolve(__dirname, '../dist');
app.use(express.static(distPath));

// SPA fallback (Express 5 syntax)
app.get('/{*path}', (req, res) => {
  if (req.url.startsWith('/api/')) {
    res.status(404).json({ error: 'API endpoint not found' });
    return;
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`LanaEco.farm server running on port ${PORT}`);
  startHeartbeat(db);
});

// Graceful shutdown
const shutdown = () => {
  console.log('Shutting down...');
  stopHeartbeat();
  closeDb();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
