'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// AI QUOTE GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

// ── Constants ─────────────────────────────────────────────────────────────────
const RATES_KEY    = 'dynasty-my-rates';
const QG_DIM_MODE  = { mode: 'lh' }; // 'lh' or 'area'

// Rate key → job type mapping
const JOB_RATE_KEYS = {
  'Brick Veneer':   'brickVeneer',
  'Double Brick':   'doubleBrick',
  'Block Work':     'blockWork',
  'Retaining Wall': 'retainingWall',
  'Footing':        'footing',
  'Fence':          'fence',
  'Paving':         'paving',
  'Pressure Clean': 'pressureClean',
  'Other':          'other',
};

// Rate label per job type (what unit the rate applies to)
const JOB_RATE_LABELS = {
  'Brick Veneer':   '$ per brick',
  'Double Brick':   '$ per brick',
  'Block Work':     '$ per block',
  'Retaining Wall': '$ per m²',
  'Footing':        '$ per lineal metre',
  'Fence':          '$ per m²',
  'Paving':         '$ per m²',
  'Pressure Clean': '$ per m²',
  'Other':          '$ per m²',
};

// ── Strip markdown symbols from text ─────────────────────────────────────────
function stripMarkdown(text) {
  return (text || '')
    // Table rows — any line that contains | characters
    .replace(/^[^\n]*\|[^\n]*$/gm, '')
    // Horizontal rules: ---, ===, ───
    .replace(/^[-=─*]{3,}\s*$/gm, '')
    // ATX headings: # ## ### etc.
    .replace(/^#{1,6}\s+/gm, '')
    // Bold: **text** or __text__
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    // Italic: *text* or _text_
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    // Blockquotes: > ...
    .replace(/^>\s*/gm, '')
    // Inline code: `code`
    .replace(/`([^`]+)`/g, '$1')
    // Fenced code blocks
    .replace(/```[\s\S]*?```/g, '')
    // Remaining stray pipe characters
    .replace(/\|/g, '')
    // Collapse 3+ blank lines → double newline
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── Saved rates helpers ───────────────────────────────────────────────────────
function loadMyRates() {
  try { return JSON.parse(localStorage.getItem(RATES_KEY) || '{}'); } catch { return {}; }
}
function saveMyRates(obj) { localStorage.setItem(RATES_KEY, JSON.stringify(obj)); }

// ── Brick counts per m² ───────────────────────────────────────────────────────
function bricksPerM2(brickType) {
  if (brickType === 'Maxi Brick')    return Math.round(1 / ((0.290 + 0.010) * (0.090 + 0.010)));
  if (brickType === 'Besser Block')  return Math.round(1 / ((0.390 + 0.010) * (0.190 + 0.010)));
  if (brickType === 'Paving Brick')  return Math.round(1 / ((0.230 + 0.003) * (0.115 + 0.003)));
  return Math.round(1 / ((0.230 + 0.010) * (0.076 + 0.010))); // Standard
}

// ── Calculate quote numbers ───────────────────────────────────────────────────
function calcQuote(fields) {
  const { jobType, brickType, dimMode, length, height, area, rate, includeMaterials, markup, includeGST } = fields;

  // Compute gross area
  let grossArea = dimMode === 'area' ? area : length * height;
  grossArea = Math.max(0, grossArea);

  // Brick/block count where applicable
  const isBrickJob = ['Brick Veneer', 'Double Brick', 'Block Work'].includes(jobType);
  const isLinealJob = jobType === 'Footing';
  const isAreaJob   = !isBrickJob && !isLinealJob;

  let unitCount = 0;
  let unitLabel = '';

  if (isBrickJob) {
    const perM2      = bricksPerM2(brickType);
    const skins      = jobType === 'Double Brick' ? 2 : 1;
    unitCount = Math.ceil(grossArea * perM2 * skins * 1.10); // +10% wastage
    unitLabel = brickType === 'Besser Block' ? 'blocks' : 'bricks';
  } else if (isLinealJob) {
    unitCount = dimMode === 'area' ? area : length;
    unitLabel = 'lineal metres';
  } else {
    unitCount = grossArea;
    unitLabel = 'm²';
  }

  // Labour cost
  const labourCost = unitCount * (rate || 0);

  // Materials cost (rough estimate based on job type)
  let materialsCost = 0;
  if (includeMaterials) {
    let baseMaterialRate = 0;
    if (isBrickJob) {
      // approx material cost per brick/block
      const matPerUnit = brickType === 'Besser Block' ? 3.50 : brickType === 'Maxi Brick' ? 1.60 : 1.20;
      baseMaterialRate = unitCount * matPerUnit;
    } else {
      // area-based jobs: rough material cost per m²
      const matPerM2 = { 'Retaining Wall': 90, 'Fence': 65, 'Paving': 55, 'Pressure Clean': 0.05, 'Footing': 45 };
      baseMaterialRate = grossArea * (matPerM2[jobType] || 30);
    }
    materialsCost = baseMaterialRate * (1 + (markup || 15) / 100);
  }

  const subtotal = labourCost + materialsCost;
  const gstAmt   = includeGST ? subtotal * 0.10 : 0;
  const total    = subtotal + gstAmt;
  const deposit  = total * 0.30;

  return {
    grossArea, unitCount, unitLabel, labourCost,
    materialsCost, subtotal, gstAmt, total, deposit,
    isBrickJob, isLinealJob,
  };
}

// ── Dimension mode toggle ─────────────────────────────────────────────────────
window.qgSetDimMode = function(mode) {
  QG_DIM_MODE.mode = mode;
  document.getElementById('qgDimLH')?.classList.toggle('qg-dim-btn--active', mode === 'lh');
  document.getElementById('qgDimArea')?.classList.toggle('qg-dim-btn--active', mode === 'area');
  const lhFields = document.getElementById('qgDimLHFields');
  const hField   = document.getElementById('qgDimHField');
  const aField   = document.getElementById('qgDimAreaField');
  if (lhFields) lhFields.style.display = mode === 'lh' ? '' : 'none';
  if (hField)   hField.style.display   = mode === 'lh' ? '' : 'none';
  if (aField)   aField.style.display   = mode === 'area' ? '' : 'none';
  qgUpdatePreview();
};

// ── Live calc preview ─────────────────────────────────────────────────────────
function qgUpdatePreview() {
  const preview = document.getElementById('qgCalcPreview');
  if (!preview) return;

  const fields = qgReadFields();
  if (!fields.jobType || (!fields.rate && fields.rate !== 0)) {
    preview.style.display = 'none';
    return;
  }
  const hasDim = fields.dimMode === 'area'
    ? (fields.area > 0)
    : (fields.length > 0 || fields.height > 0);
  if (!hasDim && !fields.rate) { preview.style.display = 'none'; return; }

  const c = calcQuote(fields);
  if (c.total <= 0 && c.unitCount <= 0) { preview.style.display = 'none'; return; }

  const unitLine = c.isBrickJob
    ? `<div class="qg-prev-row"><span>${c.unitLabel} (+ 10% wastage)</span><strong>${c.unitCount.toLocaleString()}</strong></div>`
    : c.isLinealJob
      ? `<div class="qg-prev-row"><span>Lineal metres</span><strong>${c.unitCount.toFixed(1)}</strong></div>`
      : `<div class="qg-prev-row"><span>Area</span><strong>${c.grossArea.toFixed(1)} m²</strong></div>`;

  const matLine = fields.includeMaterials
    ? `<div class="qg-prev-row"><span>Materials (+ ${fields.markup}% markup)</span><strong>${fmtCurrency(c.materialsCost)}</strong></div>`
    : '';
  const gstLine = fields.includeGST
    ? `<div class="qg-prev-row"><span>GST (10%)</span><strong>${fmtCurrency(c.gstAmt)}</strong></div>`
    : '';

  preview.style.display = '';
  preview.innerHTML = `
    <div class="qg-preview-title">&#128200; Quick Estimate Preview</div>
    ${unitLine}
    <div class="qg-prev-row"><span>Labour</span><strong>${fmtCurrency(c.labourCost)}</strong></div>
    ${matLine}
    <div class="qg-prev-divider"></div>
    ${gstLine}
    <div class="qg-prev-row qg-prev-total"><span>TOTAL</span><strong>${fmtCurrency(c.total)}</strong></div>
    <div class="qg-prev-row"><span>Deposit (30%)</span><strong>${fmtCurrency(c.deposit)}</strong></div>`;
}

// ── Read form fields ──────────────────────────────────────────────────────────
function qgReadFields() {
  return {
    client:          (document.getElementById('qg_client')?.value   || '').trim(),
    address:         (document.getElementById('qg_address')?.value  || '').trim(),
    jobType:         document.getElementById('qg_jobtype')?.value   || '',
    brickType:       document.getElementById('qg_bricktype')?.value || 'Standard Brick',
    dimMode:         QG_DIM_MODE.mode,
    length:          parseFloat(document.getElementById('qg_length')?.value  || 0) || 0,
    height:          parseFloat(document.getElementById('qg_height')?.value  || 0) || 0,
    area:            parseFloat(document.getElementById('qg_area')?.value    || 0) || 0,
    rate:            parseFloat(document.getElementById('qg_rate')?.value    || 0) || 0,
    startDate:       document.getElementById('qg_startdate')?.value || '',
    includeMaterials:document.getElementById('qg_materials')?.checked || false,
    markup:          parseFloat(document.getElementById('qg_markup')?.value  || 15) || 15,
    includeGST:      document.getElementById('qg_gst')?.checked || false,
    special:         (document.getElementById('qg_special')?.value  || '').trim(),
  };
}

// ── Build context for Claude ──────────────────────────────────────────────────
function buildQuoteContext(fields, calc) {
  const rateLabel = JOB_RATE_LABELS[fields.jobType] || '$ per unit';
  const dimDesc = fields.dimMode === 'area'
    ? `${fields.area} m²`
    : `${fields.length}m (L) × ${fields.height}m (H) = ${calc.grossArea.toFixed(1)} m²`;

  return `
QUOTE REQUEST — DYNASTY BRICKLAYING

Client: ${fields.client}
Address: ${fields.address}
Job Type: ${fields.jobType}
Material: ${fields.brickType}
Dimensions: ${dimDesc}
${calc.isBrickJob ? `Quantity: ${calc.unitCount.toLocaleString()} ${calc.unitLabel} (includes 10% wastage)` : `Quantity: ${calc.unitCount.toFixed(1)} ${calc.unitLabel}`}
Estimated Start: ${fields.startDate || 'TBC'}
Rate: ${fields.rate} ${rateLabel}
Materials included: ${fields.includeMaterials ? `Yes (${fields.markup}% markup)` : 'No'}
GST included: ${fields.includeGST ? 'Yes (10%)' : 'No'}
${fields.special ? `Special requirements: ${fields.special}` : ''}

CALCULATED COSTS:
Labour: ${fmtCurrency(calc.labourCost)}
${fields.includeMaterials ? `Materials: ${fmtCurrency(calc.materialsCost)}` : ''}
${fields.includeGST ? `GST: ${fmtCurrency(calc.gstAmt)}` : ''}
TOTAL: ${fmtCurrency(calc.total)}
Deposit (30%): ${fmtCurrency(calc.deposit)}
Balance on completion (70%): ${fmtCurrency(calc.total - calc.deposit)}
`.trim();
}

// ── Generate quote via Claude ─────────────────────────────────────────────────
async function runQuoteGeneration() {
  const fields = qgReadFields();

  if (!fields.client)  { showToast('Client name is required', 'error'); return; }
  if (!fields.address) { showToast('Job address is required', 'error'); return; }
  if (!fields.jobType) { showToast('Please select a job type', 'error'); return; }
  if (!fields.rate)    { showToast('Please enter your rate for this job', 'error'); return; }

  const hasDim = fields.dimMode === 'area' ? fields.area > 0 : (fields.length > 0 || fields.height > 0);
  if (!hasDim) { showToast('Please enter the job dimensions', 'error'); return; }

  const calc = calcQuote(fields);
  const context = buildQuoteContext(fields, calc);

  const formEl   = document.getElementById('quoteGenForm');
  const resultEl = document.getElementById('quoteGenResult');
  const textEl   = document.getElementById('quoteGenText');
  const runBtn   = document.getElementById('btnRunQuote');

  runBtn.disabled    = true;
  runBtn.textContent = '⏳ Generating quote…';
  if (textEl) {
    textEl.innerHTML = '<div class="ai-loading">Dynasty AI is writing your quote…</div>';
  }

  // Show result panel while loading
  if (formEl)   formEl.style.display   = 'none';
  if (resultEl) resultEl.style.display = '';

  const systemPrompt = `You are an expert bricklaying estimator with 15 years of experience working in Australia. You work for Dynasty Bricklaying & Pressure Cleaning.

Generate a professional formal quote document for the job described below. Use the exact costs and quantities provided — do NOT recalculate or change the numbers.

Structure your response exactly as follows:

DYNASTY BRICKLAYING & PRESSURE CLEANING
FORMAL QUOTE

Quote Reference: QB-[generate a 5-digit number]
Date: ${new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}
Valid Until: ${new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })}

PREPARED FOR:
[Client details]

SCOPE OF WORK:
[2-3 sentences describing exactly what will be done, referencing the specific job type, location, and dimensions]

MATERIALS:
[List the specific materials and quantities]

LABOUR ESTIMATE:
[Estimate working days based on the quantities provided, assuming a standard crew]

PRICE BREAKDOWN:
[Table of all costs using the exact figures provided]

PAYMENT TERMS:
• 30% deposit required on acceptance of quote: [exact deposit amount]
• 70% balance due on completion: [exact balance amount]
• Payment accepted by bank transfer

EXCLUSIONS & NOTES:
[List relevant exclusions for this specific job type — e.g. footings, permits, scaffolding hire, rubbish removal, existing structure demolition, etc.]
[Add any relevant site or job-specific notes based on special requirements]

ACCEPTANCE:
This quote is valid for 30 days from the date above. To accept, please sign below and return with the deposit payment.

Client Signature: _________________________ Date: ___________
Dynasty Representative: _________________________

Thank you for choosing Dynasty Bricklaying & Pressure Cleaning.
Contact: [leave blank for client to fill]

Keep it professional, clear, and practical. Australian English throughout.`;

  try {
    const reply = await callClaudeAPI(
      [{ role: 'user', content: context }],
      null,
      'quote',
      { systemPromptOverride: systemPrompt }
    );

    if (textEl) {
      // Strip all markdown symbols — show clean plain text only
      const cleanReply = stripMarkdown(reply);
      textEl.innerHTML = `<div class="qg-quote-output">${escHtml(cleanReply).replace(/\n/g, '<br>')}</div>`;
    }

    // Wire Copy button
    document.getElementById('btnCopyQuote')?.addEventListener('click', () => {
      navigator.clipboard.writeText(reply).then(
        () => showToast('Quote copied to clipboard!', 'success'),
        () => showToast('Copy failed', 'error')
      );
    });

    // Wire PDF button
    document.getElementById('btnSavePDF')?.addEventListener('click', () => {
      generateQuotePDF(reply, fields, calc);
    });

  } catch (err) {
    if (textEl) textEl.innerHTML = `<p class="ai-error">&#9888; ${escHtml(err.message)}</p>`;
  } finally {
    runBtn.disabled    = false;
    runBtn.textContent = '▶ Generate Quote';
  }
}

// ── Parse scope items from AI quote text ─────────────────────────────────────
function parseScopeItems(quoteText, fallbackJobType) {
  // 1. Try to isolate the SCOPE OF WORK section
  const scopeMatch = quoteText.match(
    /SCOPE OF WORK[:\s\n]+([\s\S]*?)(?=\n(?:MATERIALS|LABOUR|PRICE|PAYMENT|EXCLUSION|ACCEPTANCE|TERMS|─{3,}|={3,})|$)/i
  );
  const source = scopeMatch ? scopeMatch[1] : quoteText;

  // 2. Extract lines that look like scope items, stripped of markdown
  const lines = source
    .split('\n')
    .map(l => stripMarkdown(l).replace(/^\s*[\u2022\-\*\d]+[.):\s]*/u, '').trim())
    .filter(l =>
      l.length > 12 &&
      !/^(scope of work|materials|labour|price breakdown|payment|exclusion|acceptance|dynasty|quote ref|date:|valid|prepared|client:|address:|job type|rate:|gst:|deposit|balance|thank you)/i.test(l) &&
      !/^[─=\-|]{3,}$/.test(l)
    );

  // 3. Deduplicate, max 12 items
  const seen  = new Set();
  const items = [];
  for (const l of lines) {
    const key = l.toLowerCase().slice(0, 60);
    if (!seen.has(key) && items.length < 12) {
      seen.add(key);
      items.push(l);
    }
  }

  if (items.length === 0) {
    items.push(`Supply and lay ${escHtml(fallbackJobType)} as per quoted dimensions and specifications.`);
    items.push('All works to be completed to a high standard in accordance with Australian building standards.');
    items.push('Site to be left clean and tidy upon completion.');
  }
  return items;
}

// ── PDF generation — 4-page A4 professional quote ────────────────────────────
function generateQuotePDF(quoteText, fields, calc) {
  // ── Business profile ───────────────────────────────────────────────────────
  const bp      = (typeof loadBusinessProfile === 'function') ? loadBusinessProfile() : {};
  const bizName = bp.name    || 'Dynasty Bricklaying & Pressure Cleaning';
  const bizABN  = bp.abn     || '';
  const bizPhone= bp.phone   || '';
  const bizEmail= bp.email   || '';
  const bizAddr = bp.address || '';
  const bizLogo = bp.logo    || '';

  // ── Dates ──────────────────────────────────────────────────────────────────
  const today     = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const todayLong = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const expires   = new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // ── Quote reference ────────────────────────────────────────────────────────
  const refMatch = quoteText.match(/Q[A-Z]-?(\d{4,6})/i);
  const rawRef   = refMatch ? refMatch[1] : String(Math.floor(1000 + Math.random() * 9000));
  const quoteRef = 'Q-' + rawRef.substring(0, 5).padStart(4, '0');

  // ── Logo block (page 1 top-left) ───────────────────────────────────────────
  const logoBlock = bizLogo
    ? `<img src="${bizLogo}" style="max-height:60px;max-width:200px;object-fit:contain;display:block">`
    : `<div class="cover-logo-name">${escHtml(bizName)}</div>`;

  // ── Contact footer string (page 1 bottom) ──────────────────────────────────
  const contactLeft  = [bizABN ? 'ABN ' + bizABN : '', bizAddr].filter(Boolean).join('  ·  ');
  const contactRight = [bizPhone, bizEmail].filter(Boolean).join('  ·  ');

  // ── Parsed scope items ─────────────────────────────────────────────────────
  const scopeItems = parseScopeItems(quoteText, fields.jobType);

  // ── Pricing ────────────────────────────────────────────────────────────────
  const subtotal = calc.subtotal;
  const gstAmt   = calc.gstAmt;
  const total    = calc.total;
  const deposit  = calc.deposit;
  const balance  = total - deposit;

  // ── Dimension description ──────────────────────────────────────────────────
  const dimDesc = fields.dimMode === 'area'
    ? `${fields.area} m²`
    : `${fields.length}m × ${fields.height}m`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${escHtml(bizName)} — ${escHtml(quoteRef)}</title>
<style>
/* ── Reset ── */
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: Helvetica, Arial, sans-serif; font-size:10pt; color:#222; background:#fff; }
@page { size: A4; margin: 0; }

/* ── Page container ── */
.page {
  width: 210mm;
  min-height: 297mm;
  padding: 18mm 17mm 24mm;
  position: relative;
  background: #fff;
  page-break-after: always;
  break-after: page;
}
.page:last-child { page-break-after: avoid; break-after: avoid; }

/* ══ PAGE 1: COVER ══════════════════════════════════════════ */
/* White background, black text, gold divider only */
.cover { background: #ffffff; color: #000000; }

.cover-top {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  padding-bottom: 14pt;
  margin-bottom: 0;
}
.cover-divider {
  width: 100%;
  border: none;
  border-top: 1pt solid #C9A84C;
  margin: 0 0 32pt;
}
.cover-logo-name {
  font-size: 18pt;
  font-weight: 700;
  color: #000000;
  line-height: 1.2;
}
.cover-ref-box {
  text-align: right;
  font-size: 9pt;
  line-height: 2;
  color: #333333;
}
.cover-ref-label {
  font-size: 9pt;
  font-weight: 700;
  color: #000000;
}
.cover-ref-total {
  font-size: 9pt;
  font-weight: 700;
  color: #000000;
}

.cover-hero { margin: 0 0 28pt; }
.cover-job-title {
  font-size: 28pt;
  font-weight: 700;
  color: #000000;
  line-height: 1.15;
  letter-spacing: -0.3px;
  margin-bottom: 8pt;
}
.cover-address {
  font-size: 13pt;
  color: #666666;
  margin-bottom: 12pt;
  line-height: 1.4;
}
.cover-prepared {
  font-size: 11pt;
  color: #333333;
  line-height: 1.5;
}
.cover-prepared strong { color: #000000; font-weight: 700; }

.cover-pgnum {
  position: absolute;
  bottom: 14mm;
  right: 17mm;
  font-size: 8pt;
  color: #999999;
}

/* ══ INNER PAGE HEADER (pages 2-4) ══════════════════════════ */
.inner-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  padding-bottom: 9pt;
  margin-bottom: 18pt;
  border-bottom: 1px solid #ddd;
}
.ih-biz { font-size: 10.5pt; font-weight: 700; color: #111; }
.ih-meta { font-size: 8pt; color: #888; text-align: right; line-height: 1.65; }

/* ══ PAGE 2: COVER LETTER ═══════════════════════════════════ */
.letter-date { font-size: 10pt; color: #555; margin-bottom: 20pt; }
.letter-greeting { font-size: 10pt; font-weight: 600; color: #111; margin-bottom: 16pt; }
.letter-section-title {
  font-size: 14pt;
  font-weight: 700;
  color: #111;
  margin-bottom: 12pt;
  border-left: 3px solid #C9A84C;
  padding-left: 10pt;
}
.letter-p { font-size: 10pt; line-height: 1.8; color: #333; margin-bottom: 11pt; }
.letter-signoff { font-size: 10pt; line-height: 1.9; color: #333; margin-top: 26pt; }
.sig-gap { height: 32pt; }

/* ══ PAGE 3: QUOTE BREAKDOWN ════════════════════════════════ */
.page-title { font-size: 16pt; font-weight: 700; color: #111; margin-bottom: 4pt; }
.page-subtitle { font-size: 9pt; color: #888; margin-bottom: 14pt; }

.scope-tbl { width: 100%; border-collapse: collapse; margin-bottom: 16pt; }
.scope-tbl th {
  background: #111;
  color: #C9A84C;
  font-size: 8pt;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  padding: 6pt 10pt;
  text-align: left;
}
.scope-tbl td {
  padding: 7pt 10pt;
  font-size: 9.5pt;
  color: #333;
  border-bottom: 1px solid #eee;
  vertical-align: top;
  line-height: 1.5;
}
.scope-tbl tr:last-child td { border-bottom: none; }
.scope-num { color: #C9A84C; font-weight: 600; font-size: 8.5pt; width: 50pt; white-space: nowrap; }

.rule { border: none; border-top: 1px solid #ddd; margin: 14pt 0; }

.price-tbl { width: 240pt; margin-left: auto; border-collapse: collapse; margin-bottom: 16pt; }
.price-tbl td { padding: 5pt 8pt; font-size: 10pt; }
.price-tbl .lbl { color: #666; text-align: left; }
.price-tbl .val { font-weight: 600; color: #111; text-align: right; }
.price-tbl .total-row td { border-top: 2px solid #C9A84C; padding-top: 7pt; }
.price-tbl .total-row .lbl { font-weight: 700; color: #111; font-size: 11pt; }
.price-tbl .total-row .val { font-weight: 900; color: #111; font-size: 12pt; }

.pay-sched {
  border-left: 3px solid #C9A84C;
  background: #faf8f2;
  border: 1px solid #e8e0cc;
  border-left: 3px solid #C9A84C;
  padding: 12pt 14pt;
  margin-top: 14pt;
}
.pay-sched h3 { font-size: 10pt; font-weight: 700; color: #111; margin-bottom: 8pt; }
.pay-row {
  display: flex;
  justify-content: space-between;
  font-size: 9.5pt;
  color: #444;
  margin-bottom: 5pt;
}
.pay-row:last-child { margin-bottom: 0; }
.pay-amt { font-weight: 700; color: #111; }

/* ══ PAGE 4: TERMS ══════════════════════════════════════════ */
.terms-p { font-size: 9pt; line-height: 1.75; color: #444; margin-bottom: 10pt; }
.terms-h { font-size: 10pt; font-weight: 700; color: #111; margin: 12pt 0 3pt; }

/* ══ PAGE NUMBER ════════════════════════════════════════════ */
.pgnum { position: absolute; bottom: 14mm; right: 17mm; font-size: 8pt; color: #bbb; }

@media print {
  .page { page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: avoid; break-after: avoid; }
}
</style>
</head>
<body>

<!-- ══════════════════════════════════════════════════════════════
     PAGE 1 — COVER
══════════════════════════════════════════════════════════════ -->
<div class="page cover">

  <!-- Top row: logo/name left · ref block right -->
  <div class="cover-top">
    <div>${logoBlock}</div>
    <div class="cover-ref-box">
      <span class="cover-ref-label">Reference: ${escHtml(quoteRef)}</span><br>
      Issue Date: ${today}<br>
      Valid For: 30 days<br>
      <span class="cover-ref-total">Total: ${fmtCurrency(total)}</span>
    </div>
  </div>

  <!-- Full-width gold divider -->
  <hr class="cover-divider">

  <!-- Hero: job type, address, prepared for -->
  <div class="cover-hero">
    <div class="cover-job-title">${escHtml(fields.jobType)}</div>
    ${fields.address ? `<div class="cover-address">${escHtml(fields.address)}</div>` : ''}
    <div class="cover-prepared">Prepared for: <strong>${escHtml(fields.client)}</strong></div>
  </div>

  <div class="cover-pgnum">Page 1 of 4</div>

</div><!-- /cover -->


<!-- ══════════════════════════════════════════════════════════════
     PAGE 2 — COVER LETTER
══════════════════════════════════════════════════════════════ -->
<div class="page">

  <div class="inner-header">
    <div class="ih-biz">${escHtml(bizName)}</div>
    <div class="ih-meta">Ref: ${escHtml(quoteRef)}&nbsp;&nbsp;|&nbsp;&nbsp;${today}</div>
  </div>

  <div class="letter-date">${todayLong}</div>
  <div class="letter-greeting">Dear ${escHtml(fields.client)},</div>

  <div class="letter-section-title">Letter of Introduction</div>

  <p class="letter-p">Thank you for the opportunity to provide a quote for your upcoming project.</p>

  <p class="letter-p">At ${escHtml(bizName)}, we take pride in delivering high-quality workmanship with a focus on reliability, precision, and honest service. It&rsquo;s always a privilege to be considered for work, and we appreciate the chance to be part of your plans.</p>

  <p class="letter-p">The attached quote outlines the scope of works discussed and is based on the details provided. If there are any changes needed or you&rsquo;d like to go over anything in more detail, please feel free to get in touch.</p>

  <div class="letter-signoff">
    Warm regards,
    <div class="sig-gap"></div>
    <strong>${escHtml(bizName)}</strong>${bizPhone || bizEmail ? '<br>' : ''}
    ${[bizPhone, bizEmail].filter(Boolean).map(s => escHtml(s)).join('&nbsp;&nbsp;·&nbsp;&nbsp;')}
  </div>

  <div class="pgnum">Page 2 of 4</div>

</div><!-- /letter -->


<!-- ══════════════════════════════════════════════════════════════
     PAGE 3 — QUOTE BREAKDOWN
══════════════════════════════════════════════════════════════ -->
<div class="page">

  <div class="inner-header">
    <div class="ih-biz">${escHtml(bizName)}</div>
    <div class="ih-meta">Ref: ${escHtml(quoteRef)}&nbsp;&nbsp;|&nbsp;&nbsp;${today}</div>
  </div>

  <div class="page-title">Quote Description</div>
  <div class="page-subtitle">This is a breakdown of the quote descriptions associated with the project.</div>

  <table class="scope-tbl">
    <thead>
      <tr>
        <th style="width:54pt">Item No.</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      ${scopeItems.map((item, i) =>
        `<tr>
          <td class="scope-num">1.${String(i + 1).padStart(3, '0')}</td>
          <td>${escHtml(item)}</td>
        </tr>`
      ).join('')}
    </tbody>
  </table>

  <hr class="rule">

  <table class="price-tbl">
    <tbody>
      <tr><td class="lbl">Subtotal</td><td class="val">${fmtCurrency(subtotal)}</td></tr>
      ${gstAmt > 0 ? `<tr><td class="lbl">GST (10%)</td><td class="val">${fmtCurrency(gstAmt)}</td></tr>` : ''}
      <tr class="total-row">
        <td class="lbl">Total</td>
        <td class="val">${fmtCurrency(total)}</td>
      </tr>
    </tbody>
  </table>

  <div class="pay-sched">
    <h3>Payment Schedule</h3>
    <div class="pay-row">
      <span>30% deposit on acceptance</span>
      <span class="pay-amt">${fmtCurrency(deposit)}</span>
    </div>
    <div class="pay-row">
      <span>70% balance on completion</span>
      <span class="pay-amt">${fmtCurrency(balance)}</span>
    </div>
  </div>

  <div class="pgnum">Page 3 of 4</div>

</div><!-- /breakdown -->


<!-- ══════════════════════════════════════════════════════════════
     PAGE 4 — TERMS & CONDITIONS
══════════════════════════════════════════════════════════════ -->
<div class="page">

  <div class="inner-header">
    <div class="ih-biz">${escHtml(bizName)}</div>
    <div class="ih-meta">Ref: ${escHtml(quoteRef)}&nbsp;&nbsp;|&nbsp;&nbsp;${today}</div>
  </div>

  <div class="page-title">Terms and Conditions</div>
  <p class="page-subtitle" style="margin-bottom:14pt">Please read the following terms and conditions carefully before accepting this quote.</p>

  <p class="terms-p">This contract outlines the terms and conditions for the construction project between the contractor and the client. It includes details on scope of work, project timeline, payment schedule, and any changes or modifications to the original plan. Both parties agree to adhere to local building regulations and all applicable Australian Standards.</p>

  <div class="terms-h">1. Scope of Work</div>
  <p class="terms-p">The contractor agrees to complete the work as described in this quote. Any variation to the agreed scope of works must be submitted in writing and approved by both parties before additional work commences. Approved variations may incur additional charges.</p>

  <div class="terms-h">2. Payment</div>
  <p class="terms-p">A deposit of 30% of the quoted amount is required upon acceptance of this quote before any works commence. The remaining balance of 70% is due upon practical completion. All invoices are payable within 7 days of issue. Overdue accounts may incur interest at 10% per annum. The contractor reserves the right to suspend works if payments are not made in accordance with these terms.</p>

  <div class="terms-h">3. Variations</div>
  <p class="terms-p">Any changes requested by the client after acceptance of this quote will be treated as a variation. All variations must be agreed in writing prior to the additional work being carried out. The contract price will be adjusted accordingly. The contractor is not obliged to proceed with a variation until it has been formally approved.</p>

  <div class="terms-h">4. Delays &amp; Extensions of Time</div>
  <p class="terms-p">The contractor will make every reasonable effort to complete the works within the agreed timeframe. Delays caused by inclement weather, restricted site access, client-directed changes, supply disruptions, or circumstances beyond the contractor&rsquo;s reasonable control will extend the project completion date accordingly, without penalty to the contractor.</p>

  <div class="terms-h">5. Liability &amp; Insurance</div>
  <p class="terms-p">The contractor holds current public liability insurance. The contractor&rsquo;s liability under this agreement is limited to the value of this contract. The contractor accepts no liability for consequential, indirect, or economic loss arising from the works or any delay thereto.</p>

  <div class="terms-h">6. Defects &amp; Warranty</div>
  <p class="terms-p">The contractor warrants that all works will be carried out in a proper and workmanlike manner, using materials of acceptable quality. Any defects arising directly from the contractor&rsquo;s workmanship reported within 90 days of practical completion will be rectified at no additional charge. This warranty does not cover damage caused by third parties, misuse, or normal wear and tear.</p>

  <div class="terms-h">7. Disputes</div>
  <p class="terms-p">Any disputes arising from this contract will be subject to the laws of Australia. Both parties agree to attempt good-faith negotiation and mediation before commencing any formal legal proceedings. Nothing in this clause limits either party&rsquo;s rights under applicable Australian consumer protection legislation.</p>

  <div class="terms-h">8. Acceptance</div>
  <p class="terms-p">This quote is valid for 30 days from the issue date. Acceptance is confirmed by the client&rsquo;s written approval and payment of the deposit. By accepting this quote the client agrees to all terms and conditions stated herein.</p>

  <div class="pgnum">Page 4 of 4</div>

</div><!-- /terms -->

</body>
</html>`;

  // Open print window
  const win = window.open('', '_blank', 'width=900,height=750');
  if (!win) { showToast('Pop-up blocked — allow pop-ups to save PDF', 'error', 5000); return; }
  win.document.write(html);
  win.document.close();
  win.onload = () => { win.focus(); win.print(); };
}

// ── My Rates panel ────────────────────────────────────────────────────────────
function initMyRates() {
  const overlay  = document.getElementById('myRatesOverlay');
  const openBtn  = document.getElementById('btnMyRates');
  const closeBtn = document.getElementById('myRatesClose');
  const saveBtn  = document.getElementById('btnSaveRates');
  if (!overlay) return;

  function populateRates() {
    const rates = loadMyRates();
    overlay.querySelectorAll('[data-rate-key]').forEach(inp => {
      const v = rates[inp.dataset.rateKey];
      if (v != null) inp.value = v;
    });
  }

  openBtn?.addEventListener('click', () => {
    populateRates();
    overlay.classList.add('is-open');
  });
  closeBtn?.addEventListener('click', () => overlay.classList.remove('is-open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('is-open'); });

  saveBtn?.addEventListener('click', () => {
    const rates = {};
    overlay.querySelectorAll('[data-rate-key]').forEach(inp => {
      const v = parseFloat(inp.value);
      if (!isNaN(v) && v >= 0) rates[inp.dataset.rateKey] = v;
    });
    saveMyRates(rates);
    overlay.classList.remove('is-open');
    showToast('Rates saved', 'success', 2000);
  });
}

// ── Main init ─────────────────────────────────────────────────────────────────
(function initQuoteGenerator() {
  const overlay  = document.getElementById('quoteGenOverlay');
  const openBtn  = document.getElementById('btnGenerateQuote');
  const closeBtn = document.getElementById('quoteGenClose');
  const runBtn   = document.getElementById('btnRunQuote');
  const backBtn  = document.getElementById('btnQuoteBack');
  const jobType  = document.getElementById('qg_jobtype');
  const rateInp  = document.getElementById('qg_rate');
  const matToggle= document.getElementById('qg_materials');
  const gstToggle= document.getElementById('qg_gst');
  if (!overlay) return;

  function openModal() {
    // Reset to form view
    const formEl   = document.getElementById('quoteGenForm');
    const resultEl = document.getElementById('quoteGenResult');
    if (formEl)   formEl.style.display   = '';
    if (resultEl) resultEl.style.display = 'none';

    // Pre-fill rate from saved rates
    const savedRates = loadMyRates();
    const jt = jobType?.value;
    const key = JOB_RATE_KEYS[jt];
    if (key && savedRates[key] != null && rateInp) rateInp.value = savedRates[key];

    // Set today as default start date
    const dateInp = document.getElementById('qg_startdate');
    if (dateInp && !dateInp.value) dateInp.value = new Date().toISOString().slice(0, 10);

    overlay.classList.add('is-open');
    setTimeout(() => document.getElementById('qg_client')?.focus(), 80);
  }

  openBtn?.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', () => overlay.classList.remove('is-open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('is-open'); });

  // Back to form
  backBtn?.addEventListener('click', () => {
    const formEl   = document.getElementById('quoteGenForm');
    const resultEl = document.getElementById('quoteGenResult');
    if (formEl)   formEl.style.display   = '';
    if (resultEl) resultEl.style.display = 'none';
  });

  // Job type change → update rate label + pre-fill rate
  jobType?.addEventListener('change', () => {
    const jt = jobType.value;
    const lbl = document.getElementById('qgRateLabel');
    if (lbl) lbl.textContent = `Your Rate (${JOB_RATE_LABELS[jt] || '$ per unit'})`;

    // Pre-fill from saved rates
    const key = JOB_RATE_KEYS[jt];
    if (key) {
      const saved = loadMyRates()[key];
      if (saved != null && rateInp) rateInp.value = saved;
    }
    qgUpdatePreview();
  });

  // Materials toggle
  matToggle?.addEventListener('change', () => {
    const lbl     = document.getElementById('qgMaterialsLbl');
    const markRow = document.getElementById('qgMarkupRow');
    if (lbl)     lbl.textContent = matToggle.checked ? 'Yes' : 'No';
    if (markRow) markRow.style.display = matToggle.checked ? '' : 'none';
    qgUpdatePreview();
  });

  // GST toggle
  gstToggle?.addEventListener('change', () => {
    const lbl = document.getElementById('qgGstLbl');
    if (lbl) lbl.textContent = gstToggle.checked ? 'Yes (10%)' : 'No';
    qgUpdatePreview();
  });

  // Live preview on any input change
  ['qg_length','qg_height','qg_area','qg_rate','qg_markup'].forEach(id => {
    document.getElementById(id)?.addEventListener('input', qgUpdatePreview);
  });

  runBtn?.addEventListener('click', runQuoteGeneration);

  initMyRates();
})();
