const express = require('express');
const cors = require('cors');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const dotenv = require('dotenv');
const path = require('path');
const { getPool, query, checkConnection } = require('./db');

dotenv.config();

const app = express();

// CORS - allow credentials for cookie-based auth
const allowedOrigins = process.env.FRONTEND_URL
  ? process.env.FRONTEND_URL.split(',').map((s) => s.trim()).filter(Boolean)
  : ['http://localhost:3000'];

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Custom MariaDB session store (replaces express-mysql-session + mysql2)
class MariaDBSessionStore extends session.Store {
  get(sid, callback) {
    query('SELECT data FROM sessions WHERE session_id = ? AND expires > ?', [sid, Math.floor(Date.now() / 1000)])
      .then(rows => callback(null, rows[0] ? JSON.parse(rows[0].data) : null))
      .catch(err => callback(err));
  }
  set(sid, sess, callback) {
    const expires = sess.cookie?.expires
      ? Math.floor(new Date(sess.cookie.expires).getTime() / 1000)
      : Math.floor(Date.now() / 1000) + 86400;
    const data = JSON.stringify(sess);
    query('REPLACE INTO sessions (session_id, expires, data) VALUES (?, ?, ?)', [sid, expires, data])
      .then(() => callback(null))
      .catch(err => callback(err));
  }
  destroy(sid, callback) {
    query('DELETE FROM sessions WHERE session_id = ?', [sid])
      .then(() => callback(null))
      .catch(err => callback(err));
  }
}

// When frontend and backend are on different origins (e.g. different ports/subdomains),
// cookies need sameSite='none' + secure=true to be sent cross-origin.
const isCrossOrigin = process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes('localhost');
const isProduction = process.env.NODE_ENV === 'production';

app.use(session({
  store: new MariaDBSessionStore(),
  secret: process.env.SESSION_SECRET || 'change-this-session-secret',
  resave: false,
  saveUninitialized: false,
  proxy: isCrossOrigin || isProduction,
  cookie: {
    httpOnly: true,
    secure: isCrossOrigin || isProduction,
    sameSite: isCrossOrigin ? 'none' : 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
  },
}));

console.log(`[session] cookie: secure=${isCrossOrigin || isProduction}, sameSite=${isCrossOrigin ? 'none' : 'lax'}, proxy=${isCrossOrigin || isProduction}`);

// Routes
const authRoutes = require('./routes/auth');
const invoiceRoutes = require('./routes/invoices');
const userRoutes = require('./routes/users');
const uploadRoutes = require('./routes/upload');
const futursoftRoutes = require('./routes/futursoft');
const emailRoutes = require('./routes/email');

app.use('/api/auth', authRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/users', userRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/futursoft', futursoftRoutes);
app.use('/api/email', emailRoutes);

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    await query('SELECT 1 AS ok');
    res.json({ status: 'ok', message: 'Server is running', db: 'ok' });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'Database connection failed', error: error.message });
  }
});

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, '../frontend/build')));

  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/build', 'index.html'));
  });
}

const PORT = process.env.PORT || 5000;

async function startServer() {
  // Check database connectivity before starting
  console.log('[startup] Checking database connection...');
  const dbCheck = await checkConnection();
  if (dbCheck.ok) {
    console.log('[startup] Database connection OK');
    // Ensure sessions table exists
    try {
      await query(`CREATE TABLE IF NOT EXISTS sessions (
        session_id VARCHAR(128) NOT NULL,
        expires INT UNSIGNED NOT NULL,
        data MEDIUMTEXT,
        PRIMARY KEY (session_id)
      ) ENGINE=InnoDB`);
      console.log('[startup] Sessions table ready');
    } catch (err) {
      console.error('[startup] WARNING: Could not create sessions table:', err.message);
    }
  } else {
    console.error(`[startup] WARNING: Database connection failed: ${dbCheck.error}`);
    console.error('[startup] Server will start but features requiring DB will not work');
    console.error(`[startup] DATABASE_URL is ${process.env.DATABASE_URL ? 'set' : 'NOT SET'}`);
  }

  app.listen(PORT, () => {
    console.log(`[startup] Server is running on port ${PORT}`);

    // Start email polling scheduler
    const { startPollingScheduler } = require('./services/emailService');
    startPollingScheduler();
  });
}

startServer().catch((err) => {
  console.error('[startup] Fatal error:', err.message);
  process.exit(1);
});
