'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// AI QUOTE GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

// ── Constants ─────────────────────────────────────────────────────────────────
const RATES_KEY         = 'dynasty-my-rates';
const QUOTE_COUNTER_KEY = 'dynasty-quote-counter';

// Site photo stored as base64 string between form open and PDF generation
let _qgSitePhoto = null;

function getNextQuoteRef() {
  const n = (parseInt(localStorage.getItem(QUOTE_COUNTER_KEY) || '999', 10) || 999) + 1;
  localStorage.setItem(QUOTE_COUNTER_KEY, String(n));
  return 'Q-' + String(n).padStart(4, '0');
}
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
    sitePhoto:       _qgSitePhoto || null,
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

// ── Auto-increment quote reference ───────────────────────────────────────────
// (getNextQuoteRef defined at top of file)

// ── PDF generation — two HTML templates, opens in new tab ────────────────────
function generateQuotePDF(quoteText, fields, calc) {
  const bp         = (typeof loadBusinessProfile === 'function') ? loadBusinessProfile() : {};
  const bizName    = bp.name    || 'Dynasty Bricklaying & Pressure Cleaning';
  const bizABN     = bp.abn     || '';
  const bizPhone   = bp.phone   || '';
  const bizEmail   = bp.email   || '';
  const bizAddr    = bp.address || '';
  const bizLogo    = bp.logo    || '';
  const sitePhoto  = fields.sitePhoto || null;

  const today     = new Date().toLocaleDateString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const todayLong = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

  const quoteRef   = getNextQuoteRef();
  const scopeItems = parseScopeItems(quoteText, fields.jobType);
  const subtotal   = calc.subtotal;
  const gstAmt     = calc.gstAmt;
  const total      = calc.total;
  const deposit    = calc.deposit;
  const balance    = total - deposit;

  // Template variant
  const isPC       = /pressure\s*clean/i.test(fields.jobType);
  const accentColor = isPC ? '#27AE60' : '#4A90B8';

  // ── Helpers ──────────────────────────────────────────────────────────────
  function h(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function money(n) {
    return '$' + (n || 0).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // ── Logo block ────────────────────────────────────────────────────────────
  const logoHtml = bizLogo
    ? `<img src="${bizLogo}" style="max-height:60px;max-width:200px;object-fit:contain;display:block" alt="Logo">`
    : `<div style="font-size:18px;font-weight:700;color:#1a1a1a">${h(bizName)}</div>`;

  // ── Site photo block ──────────────────────────────────────────────────────
  const photoHtml = sitePhoto
    ? `<img src="${sitePhoto}" style="width:100%;max-height:350px;object-fit:cover;border-radius:6px;display:block">`
    : `<div style="width:100%;height:200px;background:#f0f0f0;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#999;font-size:14px;font-style:italic">No site photo provided</div>`;

  // ── Contact footer text ────────────────────────────────────────────────────
  const contactParts = [
    bizPhone && h(bizPhone),
    bizEmail && h(bizEmail),
    bizAddr  && h(bizAddr),
    bizABN   && ('ABN ' + h(bizABN)),
  ].filter(Boolean);

  // ── Scope items rows ──────────────────────────────────────────────────────
  const scopeRows = scopeItems.map((item, i) =>
    `<tr style="background:${i % 2 === 0 ? '#ffffff' : '#f9f9f9'}">
      <td style="padding:8px 12px;white-space:nowrap;color:#555;font-size:13px;border-bottom:1px solid #eee">1.${String(i + 1).padStart(3, '0')}</td>
      <td style="padding:8px 12px;font-size:13px;border-bottom:1px solid #eee">${h(item)}</td>
    </tr>`
  ).join('');

  // ── Price rows ────────────────────────────────────────────────────────────
  const priceRows = [
    ['Subtotal', money(subtotal), false],
    ...(gstAmt > 0 ? [['GST (10%)', money(gstAmt), false]] : []),
    ['Total', money(total), true],
  ].map(([lbl, val, bold]) =>
    `<tr>
      <td style="padding:5px 0;font-size:13px;color:${bold ? '#1a1a1a' : '#555'};${bold ? 'font-weight:700;font-size:15px' : ''}">${lbl}</td>
      <td style="padding:5px 0;text-align:right;font-size:13px;color:${bold ? '#1a1a1a' : '#555'};${bold ? 'font-weight:700;font-size:15px' : ''}">${val}</td>
    </tr>`
  ).join('');

  // ── T&C body copy — variant per template ──────────────────────────────────
  const tcIntro = isPC
    ? 'This agreement sets out the terms and conditions for pressure cleaning services provided by the contractor. By accepting this quote the client agrees to the following terms.'
    : 'This contract outlines the terms and conditions for the construction project between the contractor and the client. It includes details on scope of work, payment schedule, and any variations. Both parties agree to adhere to applicable Australian Standards.';

  const tcSections = isPC ? [
    ['1. Scope of Work', 'The contractor agrees to carry out the pressure cleaning works as described in this quote. Any additional areas or surfaces not listed are excluded and will be quoted separately.'],
    ['2. Water & Surface Conditions', 'The client is responsible for ensuring that an adequate water supply is available on site at no cost to the contractor. The contractor accepts no liability for pre-existing surface damage, efflorescence, staining, or deterioration that cannot be removed by standard pressure cleaning methods.'],
    ['3. Surface Damage Liability', 'Pressure cleaning may dislodge loose mortar, paint, or damaged material. The contractor will take all reasonable care but accepts no liability for pre-existing weakened surfaces. Any known fragile areas must be disclosed by the client prior to commencement.'],
    ['4. Payment', 'A 30% deposit is required on acceptance. The balance of 70% is due upon completion. Invoices are payable within 7 days of issue. Overdue accounts may incur interest at 10% per annum.'],
    ['5. Variations', 'Any additional work requested after acceptance will be treated as a variation and priced accordingly in writing before the work commences.'],
    ['6. Acceptance', 'This quote is valid for 30 days from the issue date. Acceptance is confirmed by written approval and payment of the deposit.'],
  ] : [
    ['1. Scope of Work', 'The contractor agrees to complete the masonry works as described in this quote. Any variation must be approved in writing by both parties before additional work commences. Approved variations may incur additional charges.'],
    ['2. Payment', 'A 30% deposit is required upon acceptance before works commence. The remaining 70% is due on practical completion. All invoices are payable within 7 days. Overdue accounts may incur interest at 10% per annum.'],
    ['3. Variations', 'Changes requested after acceptance will be treated as variations and must be agreed in writing. The contractor is not obliged to proceed with a variation until formally approved.'],
    ['4. Delays & Extensions of Time', 'The contractor will make every effort to meet the agreed timeframe. Delays caused by weather, site access issues, supply disruptions, or client-directed changes will extend the completion date without penalty to the contractor.'],
    ['5. Liability & Insurance', 'The contractor holds current public liability insurance. Liability is limited to the value of this contract. No liability is accepted for indirect or consequential loss.'],
    ['6. Defects & Warranty', 'All works will be completed in a proper and workmanlike manner. Defects arising directly from workmanship reported within 90 days of completion will be rectified at no charge. This does not cover third-party damage or normal wear and tear.'],
    ['7. Disputes', 'Disputes will be subject to Australian law. Both parties agree to attempt good-faith negotiation before formal proceedings.'],
    ['8. Acceptance', 'This quote is valid for 30 days. Acceptance is confirmed by written approval and payment of the deposit.'],
  ];

  const tcHtml = tcSections.map(([heading, body]) =>
    `<div style="margin-bottom:10px">
      <div style="font-weight:700;font-size:13px;color:#1a1a1a;margin-bottom:3px">${h(heading)}</div>
      <p style="margin:0;font-size:12.5px;color:#444;line-height:1.55">${h(body)}</p>
    </div>`
  ).join('');

  // ════════════════════════════════════════════════════════════════════════════
  //  BUILD HTML
  // ════════════════════════════════════════════════════════════════════════════
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${h(bizName)} — ${h(quoteRef)}</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size:14px; line-height:1.6; color:#1a1a1a; background:#fff; }
@page { size: A4; margin: 25mm; }
.page { page-break-after: always; break-after: page; position:relative; min-height: calc(297mm - 50mm); }
.page:last-child { page-break-after: avoid; break-after: avoid; }
p { margin-bottom: 12px; }
@media print {
  .page { page-break-after: always; break-after: page; }
  .page:last-child { page-break-after: avoid; break-after: avoid; }
}
.pg-num { position:absolute; bottom:0; right:0; font-size:11px; font-style:italic; color:#999; }
</style>
</head>
<body>

<!-- ═══════════════════════════════════════════
     PAGE 1 — COVER
════════════════════════════════════════════ -->
<div class="page">

  <!-- Header: logo + ref block -->
  <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px">
    <div>${logoHtml}</div>
    <div style="text-align:right;font-size:12px;line-height:1.8;color:#555">
      <div><span style="color:#999">Reference:</span> <strong style="color:#1a1a1a">${h(quoteRef)}</strong></div>
      <div><span style="color:#999">Issue Date:</span> ${today}</div>
      <div><span style="color:#999">Valid For:</span> 30 days</div>
      <div style="margin-top:4px"><span style="color:#999">Total:</span> <strong style="font-size:14px;color:#1a1a1a">${money(total)}</strong></div>
    </div>
  </div>

  <!-- Divider -->
  <hr style="border:none;border-top:1px solid #ddd;margin-bottom:18px">

  <!-- Job title + details -->
  <h1 style="font-size:36px;font-weight:700;color:#1a1a1a;line-height:1.1;margin-bottom:8px">${h(fields.jobType)}</h1>
  ${fields.address ? `<div style="font-size:16px;color:${accentColor};margin-bottom:8px">${h(fields.address)}</div>` : ''}
  <div style="font-size:14px;margin-bottom:20px">Prepared for: <strong>${h(fields.client)}</strong></div>

  <!-- Site photo -->
  <div style="margin-bottom:18px">${photoHtml}</div>

  <div class="pg-num">Page 1 of 4</div>
</div>


<!-- ═══════════════════════════════════════════
     PAGE 2 — COVER LETTER
════════════════════════════════════════════ -->
<div class="page">

  <div style="font-size:13px;color:#555;margin-bottom:18px">${todayLong}</div>

  <div style="font-size:14px;margin-bottom:16px">Dear ${h(fields.client)},</div>

  <div style="font-size:15px;font-weight:700;color:#1a1a1a;margin-bottom:14px">Letter of Introduction</div>

  <p>Thank you for the opportunity to provide a quote for your upcoming project.</p>
  <p>At ${h(bizName)}, we take pride in delivering high-quality workmanship with a focus on reliability, precision, and honest service. It’s always a privilege to be considered for work in our local area, and we appreciate the chance to be part of your plans.</p>
  <p>The attached quote outlines the scope of works discussed and is based on the details provided. If there are any changes needed or if you’d like to go over anything in more detail, please feel free to get in touch.</p>

  <div style="margin-top:28px">
    <div>Warm regards,</div>
    <div style="height:22px"></div>
    <div><strong>${h(bizName)}</strong></div>
    ${contactParts.length ? `<div style="font-size:13px;color:#555;margin-top:4px">${contactParts.join(' &nbsp;·&nbsp; ')}</div>` : ''}
  </div>

  <div class="pg-num">Page 2 of 4</div>
</div>


<!-- ═══════════════════════════════════════════
     PAGE 3 — QUOTE BREAKDOWN
════════════════════════════════════════════ -->
<div class="page">

  <h2 style="font-size:20px;font-weight:700;color:#1a1a1a;margin-bottom:6px">Quote Descriptions</h2>
  <p style="font-size:13px;color:#888;margin-bottom:16px">This is a breakdown of the quote descriptions associated with the project.</p>

  <table style="width:100%;border-collapse:collapse;margin-bottom:20px">
    <thead>
      <tr style="background:#f4f4f4">
        <th style="padding:9px 12px;text-align:left;font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #ddd;width:72px">REF</th>
        <th style="padding:9px 12px;text-align:left;font-size:12px;font-weight:700;color:#555;text-transform:uppercase;letter-spacing:0.04em;border-bottom:2px solid #ddd">DESCRIPTION</th>
      </tr>
    </thead>
    <tbody>
      ${scopeRows}
    </tbody>
  </table>

  <!-- Price summary -->
  <div style="display:flex;justify-content:flex-end">
    <div style="min-width:240px">
      <hr style="border:none;border-top:1px solid #ddd;margin-bottom:8px">
      <table style="width:100%">
        <tbody>${priceRows}</tbody>
      </table>
    </div>
  </div>

  <div class="pg-num">Page 3 of 4</div>
</div>


<!-- ═══════════════════════════════════════════
     PAGE 4 — TERMS & CONDITIONS
════════════════════════════════════════════ -->
<div class="page">

  <h2 style="font-size:20px;font-weight:700;color:#1a1a1a;margin-bottom:6px">Terms and Conditions</h2>
  <p style="font-size:13px;color:#888;margin-bottom:14px">${h(tcIntro)}</p>

  ${tcHtml}

  <!-- Payment schedule -->
  <div style="margin-top:20px;background:#f8f8f8;border-radius:6px;padding:14px 16px">
    <div style="font-weight:700;font-size:13px;margin-bottom:8px;color:#1a1a1a">Payment Schedule</div>
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
      <span style="color:#555">30% deposit on acceptance</span>
      <strong>${money(deposit)}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:13px">
      <span style="color:#555">70% balance on completion</span>
      <strong>${money(balance)}</strong>
    </div>
  </div>

  <!-- Signature block -->
  <div style="margin-top:28px;display:grid;grid-template-columns:1fr 1fr;gap:30px">
    <div>
      <div style="font-size:12px;color:#999;margin-bottom:4px">Client Signature</div>
      <div style="border-bottom:1px solid #ccc;height:36px"></div>
      <div style="font-size:11px;color:#aaa;margin-top:4px">Date: ___________</div>
    </div>
    <div>
      <div style="font-size:12px;color:#999;margin-bottom:4px">Authorised By (${h(bizName)})</div>
      <div style="border-bottom:1px solid #ccc;height:36px"></div>
      <div style="font-size:11px;color:#aaa;margin-top:4px">Date: ___________</div>
    </div>
  </div>

  <div style="position:absolute;bottom:0;left:0;right:0;display:flex;justify-content:space-between;align-items:flex-end">
    <div style="font-size:10px;color:#ccc">Powered by Dynasty OS</div>
    <div class="pg-num" style="position:static">Page 4 of 4</div>
  </div>

</div>

</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=800');
  if (!win) { showToast('Pop-up blocked — allow pop-ups to save PDF', 'error', 5000); return; }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.addEventListener('load', function () {
    win.focus();
    win.print();
  });
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

  // ── Photo upload handler ───────────────────────────────────────────────────
  const photoInput   = document.getElementById('qg_sitePhoto');
  const photoPreview = document.getElementById('qgPhotoPreview');
  const photoImg     = document.getElementById('qgPhotoImg');
  const photoClear   = document.getElementById('qgPhotoClear');
  const photoLblTxt  = document.getElementById('qgPhotoLabelText');

  photoInput?.addEventListener('change', () => {
    const file = photoInput.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { showToast('Photo too large — max 5 MB', 'error'); photoInput.value = ''; return; }
    const reader = new FileReader();
    reader.onload = e => {
      _qgSitePhoto = e.target.result;
      if (photoImg)     { photoImg.src = _qgSitePhoto; }
      if (photoPreview) { photoPreview.style.display = 'flex'; }
      if (photoLblTxt)  { photoLblTxt.textContent = '\uD83D\uDDBC\uFE0F ' + file.name; }
    };
    reader.readAsDataURL(file);
  });

  photoClear?.addEventListener('click', () => {
    _qgSitePhoto = null;
    if (photoInput)   photoInput.value = '';
    if (photoImg)     photoImg.src = '';
    if (photoPreview) photoPreview.style.display = 'none';
    if (photoLblTxt)  photoLblTxt.textContent = '\uD83D\uDCF7 Choose photo\u2026';
  });

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
