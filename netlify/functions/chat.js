'use strict';

exports.handler = async (event) => {
  // ── Method guard ────────────────────────────────────────────────────────────
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Read + sanitise the API key ─────────────────────────────────────────────
  // Trim whitespace/newlines — a common issue when pasting into Netlify dashboard
  const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim();

  console.log('[chat] Key present:', Boolean(apiKey));
  console.log('[chat] Key prefix  :', apiKey ? apiKey.slice(0, 10) + '…' : '(empty)');
  console.log('[chat] Key length  :', apiKey.length);

  if (!apiKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'ANTHROPIC_API_KEY environment variable is not set' }),
    };
  }

  // ── Parse request body ──────────────────────────────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { messages, system } = body;
  console.log('[chat] messages count:', Array.isArray(messages) ? messages.length : 'not array');

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'messages array is required' }) };
  }

  // ── Call Anthropic ──────────────────────────────────────────────────────────
  const requestBody = {
    model:      'claude-sonnet-4-6',
    max_tokens: 1024,
    system:     system || 'You are Dynasty AI, a business assistant for Dynasty Bricklaying.',
    messages,
  };

  console.log('[chat] Calling Anthropic model:', requestBody.model);

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (fetchErr) {
    console.error('[chat] Network error calling Anthropic:', fetchErr.message);
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Network error reaching Anthropic: ' + fetchErr.message }),
    };
  }

  const data = await anthropicRes.json().catch(() => ({}));

  console.log('[chat] Anthropic status:', anthropicRes.status);
  if (!anthropicRes.ok) {
    // Log the full error object so it appears in Netlify function logs
    console.error('[chat] Anthropic error response:', JSON.stringify(data));
    return {
      statusCode: anthropicRes.status,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        error: data.error?.message || 'Anthropic API error',
        type:  data.error?.type   || 'unknown',
        debug: `Anthropic returned ${anthropicRes.status}`,
      }),
    };
  }

  const text = data.content?.[0]?.text || '(No response)';
  console.log('[chat] Success, reply length:', text.length);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  };
};
