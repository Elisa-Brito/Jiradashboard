const express = require('express');
const crypto = require('crypto');
const store = require('./store');
const { processWebhookEvent } = require('./processor');

const router = express.Router();

function validateSignature(req) {
  const secret = process.env.JIRA_WEBHOOK_SECRET;
  if (!secret) return true; // skip validation in dev when secret not configured

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

router.post('/jira', (req, res) => {
  if (!validateSignature(req)) {
    console.warn('[Webhook] Assinatura inválida — request ignorado');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;
  const eventType = event.webhookEvent || 'unknown';

  const HANDLED_EVENTS = [
    'jira:issue_created',
    'jira:issue_updated',
    'jira:issue_deleted',
  ];

  if (!HANDLED_EVENTS.includes(eventType)) {
    return res.status(200).json({ message: 'Event ignored', eventType });
  }

  try {
    const current = store.read();
    const updated = processWebhookEvent(event, current);
    store.write(updated);

    console.log(`[Webhook] ${eventType} → ${event.issue?.key} → métricas atualizadas`);
    res.status(200).json({ message: 'Processed', key: event.issue?.key });
  } catch (err) {
    console.error('[Webhook] Erro ao processar evento:', err);
    res.status(500).json({ error: 'Processing error' });
  }
});

module.exports = router;
