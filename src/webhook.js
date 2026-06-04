const express = require('express');
const crypto = require('crypto');
const { runSeed } = require('./seed');

const router = express.Router();

function validateSignature(req) {
  const secret = process.env.JIRA_WEBHOOK_SECRET;
  if (!secret) return true;

  const signature = req.headers['x-hub-signature'];
  if (!signature) return false;

  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(req.rawBody || '');
  const digest = 'sha256=' + hmac.digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest));
  } catch {
    return false;
  }
}

const HANDLED_EVENTS = [
  'jira:issue_created',
  'jira:issue_updated',
  'jira:issue_deleted',
];

// Debounce: evita múltiplos re-seeds se o Jira disparar vários eventos em sequência
let debounceTimer = null;

function scheduleSeed(key, eventType) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {
    try {
      console.log(`[Webhook] Re-seed disparado por ${eventType} → ${key}`);
      await runSeed();
      console.log(`[Webhook] Re-seed concluído`);
    } catch (err) {
      console.error('[Webhook] Erro no re-seed:', err.message);
    }
  }, 2000); // aguarda 2s para agrupar eventos em rajada
}

router.post('/jira', (req, res) => {
  if (!validateSignature(req)) {
    console.warn('[Webhook] Assinatura inválida — request ignorado');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;
  const eventType = event.webhookEvent || 'unknown';

  if (!HANDLED_EVENTS.includes(eventType)) {
    return res.status(200).json({ message: 'Event ignored', eventType });
  }

  const key = event.issue?.key || '?';
  scheduleSeed(key, eventType);

  // Responde imediatamente — o re-seed roda em background
  res.status(200).json({ message: 'Queued', key, eventType });
});

module.exports = router;
