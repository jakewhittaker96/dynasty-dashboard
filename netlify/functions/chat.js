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
  let maxTokens = 1024;

  if (role === 'summary') {
    systemPrompt =
      `You are Dynasty AI, a business analyst assistant for Dynasty Bricklaying, an Australian ` +
      `bricklaying and pressure cleaning business. Write professional, clear business summaries ` +
      `in plain Australian English. Today's date is included in the business data below.\n\n` +
      businessContext;
  } else if (role === 'plan') {
    maxTokens = 2048;
    systemPrompt =
      `You are a quantity surveyor and estimator for Dynasty Bricklaying, an Australian bricklaying ` +
      `business. You will be given extracted text from a building plan or architectural drawing.\n\n` +
      `Your job is to analyse the plan and produce a detailed bricklaying estimate. Follow these rules:\n` +
      `- Identify all brick/block walls and calculate their area in m²\n` +
      `- Assume standard brick size 230×76mm laid in stretcher bond unless stated otherwise\n` +
      `- Bricks per m²: 50 (standard face brick)\n` +
      `- Add 10% wastage to brick count\n` +
      `- Mortar: 1 bag per 25 bricks (approx)\n` +
      `- Wall ties: 1 per 0.5 m²\n` +
      `- Crew productivity: 3 bricklayers laying 1,000 bricks/day combined\n` +
      `- Quote rate: AUD $5.20 per brick (supply + lay, includes materials)\n\n` +
      `Present your output in this exact format:\n` +
      `WALL AREAS\n` +
      `[List each wall/section with dimensions and m²]\n\n` +
      `TOTAL AREA: X m²\n\n` +
      `MATERIALS\n` +
      `Bricks (inc. 10% wastage): X,XXX\n` +
      `Mortar bags: XX\n` +
      `Wall ties: XXX\n\n` +
      `LABOUR\n` +
      `Days on site (3-man crew): X days\n\n` +
      `QUOTE PRICE: $XX,XXX\n\n` +
      `NOTES\n` +
      `[Any assumptions, exclusions, or flags about the plan]\n\n` +
      `If the extracted text does not appear to be a building plan, say so clearly and ask for a clearer PDF.`;
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
        max_tokens: maxTokens,
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
