'use strict';

exports.handler = async (event) => {
  // ── Method guard ─────────────────────────────────────────────────────────────
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── API key ───────────────────────────────────────────────────────────────────
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();
  console.log('[chat] key present:', Boolean(apiKey));
  console.log('[chat] key prefix :', apiKey ? apiKey.slice(0, 10) + '…' : '(empty)');
  console.log('[chat] key length :', apiKey.length);

  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY environment variable is not set' }),
    };
  }

  // ── Parse body ────────────────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { messages, context, role = 'chat' } = body;

  console.log('[chat] role            :', role);
  console.log('[chat] messages count  :', Array.isArray(messages) ? messages.length : 'not array');
  console.log('[chat] context length  :', typeof context === 'string' ? context.length : '(none)');
  if (context) {
    console.log('[chat] context snippet :', context.slice(0, 120).replace(/\n/g, ' '));
  }

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'messages array is required' }) };
  }

  // ── Build system prompt server-side ──────────────────────────────────────────
  const businessContext = context
    ? `Here is the current live business data from the Dynasty Dashboard:\n\n${context}`
    : 'No live business data was provided for this request.';

  let systemPrompt;
  if (role === 'summary') {
    systemPrompt =
      `You are Dynasty AI, a business analyst assistant for Dynasty Bricklaying, an Australian ` +
      `bricklaying and pressure cleaning business. Write professional, clear business summaries ` +
      `in plain Australian English. Today's date is included in the business data below.\n\n` +
      businessContext;
  } else {
    systemPrompt =
      `You are Dynasty AI, a business assistant for Dynasty Bricklaying, an Australian bricklaying ` +
      `and pressure cleaning business. Answer questions about jobs, revenue, crew, sites, invoices, ` +
      `and business decisions. Be concise, practical, and use Australian English.\n\n` +
      businessContext;
  }

  console.log('[chat] system prompt length:', systemPrompt.length);

  // ── Call Anthropic ────────────────────────────────────────────────────────────
  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 1024,
        system:     systemPrompt,
        messages,
      }),
    });
  } catch (fetchErr) {
    console.error('[chat] network error:', fetchErr.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Network error reaching Anthropic: ' + fetchErr.message }),
    };
  }

  const data = await anthropicRes.json().catch(() => ({}));
  console.log('[chat] anthropic status:', anthropicRes.status);

  if (!anthropicRes.ok) {
    console.error('[chat] anthropic error:', JSON.stringify(data));
    return {
      statusCode: anthropicRes.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: data.error?.message || 'Anthropic API error',
        type:  data.error?.type   || 'unknown',
      }),
    };
  }

  const text = data.content?.[0]?.text || '(No response)';
  console.log('[chat] reply length:', text.length);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  };
};
