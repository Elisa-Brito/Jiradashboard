require('dotenv').config();
const express = require('express');
const path = require('path');
const webhookRouter = require('./webhook');
const store = require('./store');
const { runSeed } = require('./seed');

const app = express();

// Preserve rawBody for HMAC validation
app.use(express.json({
  verify: (req, res, buf) => { req.rawBody = buf; }
}));

app.use(express.static(path.join(__dirname, '../public')));

app.use('/webhook', webhookRouter);

app.get('/api/metrics', (req, res) => {
  const metrics = store.read();
  res.json(metrics);
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`[Server] Dashboard rodando em http://localhost:${PORT}`);
  console.log(`[Server] Webhook endpoint: POST http://localhost:${PORT}/webhook/jira`);

  // Auto-seed on startup if metrics are empty
  const current = store.read();
  if (!current.lastUpdated) {
    runSeed().catch(err => console.error('[Seed] Erro:', err.message));
  }
});
