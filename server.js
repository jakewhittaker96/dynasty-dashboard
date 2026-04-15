'use strict';

require('dotenv').config();

const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = 3001;

// ── CORS: allow the local file, localhost dev, and GitHub Pages ───────────────
const ALLOWED_ORIGINS = [
  'http://localhost',
  'http://localhost:3000',
  'http://localhost:5500',
  'http://127.0.0.1',
  'http://127.0.0.1:5500',
  /^https:\/\/.*\.github\.io$/,
  /^https:\/\/jakewhittaker96\.github\.io$/,
];

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (e.g. file://, Postman, start.bat direct)
    if (!origin) return cb(null, true);
    const ok = ALLOWED_ORIGINS.some(o =>
      typeof o === 'string' ? o === origin : o.test(origin)
    );
    cb(ok ? null : new Error('CORS: origin not allowed'), ok);
  },
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}));

app.use(express.json({ limit: '256kb' }));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
  res.json({ ok: true, keyLoaded: hasKey });
});

// ── Chat endpoint ─────────────────────────────────────────────────────────────
app.post('/api/chat', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in .env' });
  }

  const { messages, system } = req.body;

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        system:     system || 'You are Dynasty AI, a business assistant for Dynasty Bricklaying.',
        messages,
      }),
    });

    const data = await anthropicRes.json();

    if (!anthropicRes.ok) {
      console.error('[Proxy] Anthropic error:', data);
      return res.status(anthropicRes.status).json({ error: data.error?.message || 'Anthropic API error' });
    }

    const text = data.content?.[0]?.text || '(No response)';
    res.json({ text });

  } catch (err) {
    console.error('[Proxy] Fetch failed:', err.message);
    res.status(502).json({ error: 'Proxy fetch failed: ' + err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n  Dynasty AI Proxy running on http://localhost:${PORT}`);
  console.log(`  Health check: http://localhost:${PORT}/api/health`);
  console.log(`  API key loaded: ${Boolean(process.env.ANTHROPIC_API_KEY)}\n`);
});
