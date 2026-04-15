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
      textEl.innerHTML = `<div class="qg-quote-output">${escHtml(reply)
        .replace(/\n/g, '<br>')
        .replace(/─+|={3,}|-{3,}/g, '<hr class="qg-hr">')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      }</div>`;
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

// ── PDF generation ────────────────────────────────────────────────────────────
function generateQuotePDF(quoteText, fields, calc) {
  const bp         = (typeof loadBusinessProfile === 'function') ? loadBusinessProfile() : {};
  const bizName    = bp.name    || 'Dynasty Bricklaying & Pressure Cleaning';
  const bizABN     = bp.abn     || '';
  const bizPhone   = bp.phone   || '';
  const bizEmail   = bp.email   || '';
  const bizAddress = bp.address || '';
  const bizTerms   = bp.terms   || '30% deposit on acceptance, 70% on completion. Payment by bank transfer.';
  const bizLogo    = bp.logo    || '';

  const today      = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });
  const validUntil = new Date(Date.now() + 30 * 86400000).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' });

  const logoHtml = bizLogo
    ? `<img src="${bizLogo}" alt="Logo" style="max-height:56px;max-width:160px;object-fit:contain;display:block;margin-bottom:6px" />`
    : '';
  const contactLines = [
    bizABN     ? `ABN: ${escHtml(bizABN)}`         : '',
    bizPhone   ? `Phone: ${escHtml(bizPhone)}`      : '',
    bizEmail   ? `Email: ${escHtml(bizEmail)}`      : '',
    bizAddress ? escHtml(bizAddress)                 : '',
  ].filter(Boolean).join('<br>');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${escHtml(bizName)} — Quote for ${escHtml(fields.client)}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: Arial, sans-serif; font-size: 11pt; color: #222; background: #fff; padding: 40px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-bottom: 20px; border-bottom: 3px solid #C9A84C; }
  .brand-name { font-size: 20pt; font-weight: 900; color: #111; letter-spacing: -0.5px; }
  .brand-sub  { font-size: 9pt; color: #666; margin-top: 3px; text-transform: uppercase; letter-spacing: 1px; }
  .gold-bar   { width: 60px; height: 4px; background: #C9A84C; margin-top: 6px; }
  .header-right { text-align: right; font-size: 9pt; color: #555; line-height: 1.8; }
  .header-right strong { font-size: 10pt; color: #222; display: block; margin-bottom: 4px; }
  h2 { font-size: 13pt; color: #111; margin: 20px 0 8px; border-left: 4px solid #C9A84C; padding-left: 10px; }
  p  { line-height: 1.6; margin-bottom: 8px; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 16px 0; }
  .meta-box  { background: #f8f6f0; border: 1px solid #e8e0cc; border-radius: 4px; padding: 12px; }
  .meta-label{ font-size: 8pt; text-transform: uppercase; letter-spacing: 0.8px; color: #888; margin-bottom: 4px; }
  .meta-val  { font-size: 10pt; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; }
  th { background: #111; color: #C9A84C; text-align: left; padding: 8px 10px; font-size: 9pt; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 7px 10px; border-bottom: 1px solid #eee; font-size: 10pt; }
  tr:last-child td { border-bottom: none; }
  .total-row td { background: #f8f6f0; font-weight: 700; border-top: 2px solid #C9A84C; }
  .total-row td:last-child { color: #C9A84C; font-size: 12pt; }
  .payment-box { background: #111; color: #fff; border-radius: 4px; padding: 16px; margin: 16px 0; }
  .payment-box h3 { color: #C9A84C; font-size: 11pt; margin-bottom: 10px; }
  .payment-box p  { font-size: 9.5pt; color: #ddd; margin-bottom: 5px; }
  .payment-box .amt { color: #fff; font-weight: 700; }
  ul { margin: 8px 0 8px 20px; }
  li { font-size: 10pt; line-height: 1.7; color: #444; }
  .sig-section { margin-top: 32px; padding-top: 20px; border-top: 1px solid #ddd; display: grid; grid-template-columns: 1fr 1fr; gap: 32px; }
  .sig-box { border: 1px solid #ccc; border-radius: 4px; padding: 16px; min-height: 80px; }
  .sig-label { font-size: 8.5pt; color: #888; margin-bottom: 6px; }
  .sig-line  { border-bottom: 1px solid #ccc; margin-top: 40px; }
  .footer { margin-top: 24px; text-align: center; font-size: 8.5pt; color: #aaa; }
  .quote-body { white-space: pre-wrap; font-family: Arial, sans-serif; font-size: 10pt; line-height: 1.7; background: #fafaf9; border: 1px solid #e8e0cc; border-radius: 4px; padding: 20px; margin: 16px 0; }
  @media print { body { padding: 20px; } }
</style>
</head>
<body>

<div class="header">
  <div>
    ${logoHtml}
    <div class="brand-name">${escHtml(bizName)}</div>
    <div class="gold-bar"></div>
  </div>
  <div class="header-right">
    <strong>FORMAL QUOTE</strong>
    Date: ${today}<br>
    Valid Until: ${validUntil}<br>
    ${contactLines}
  </div>
</div>

<div class="meta-grid">
  <div class="meta-box">
    <div class="meta-label">Prepared For</div>
    <div class="meta-val">${escHtml(fields.client)}</div>
    <div style="font-size:9.5pt;color:#555;margin-top:4px">${escHtml(fields.address)}</div>
  </div>
  <div class="meta-box">
    <div class="meta-label">Job Details</div>
    <div class="meta-val">${escHtml(fields.jobType)}</div>
    <div style="font-size:9.5pt;color:#555;margin-top:4px">
      Est. Start: ${fields.startDate || 'TBC'}<br>
      ${escHtml(fields.brickType)}
    </div>
  </div>
</div>

<h2>Price Breakdown</h2>
<table>
  <thead><tr><th>Item</th><th style="text-align:right">Amount</th></tr></thead>
  <tbody>
    <tr><td>Labour — ${escHtml(fields.jobType)}</td><td style="text-align:right">${fmtCurrency(calc.labourCost)}</td></tr>
    ${fields.includeMaterials ? `<tr><td>Materials (+ ${fields.markup}% markup)</td><td style="text-align:right">${fmtCurrency(calc.materialsCost)}</td></tr>` : ''}
    ${fields.includeGST ? `<tr><td>GST (10%)</td><td style="text-align:right">${fmtCurrency(calc.gstAmt)}</td></tr>` : ''}
    <tr class="total-row"><td><strong>TOTAL</strong></td><td style="text-align:right"><strong>${fmtCurrency(calc.total)}</strong></td></tr>
  </tbody>
</table>

<div class="payment-box">
  <h3>Payment Terms</h3>
  <p>&#9679; Deposit (30%) due on acceptance: <span class="amt">${fmtCurrency(calc.deposit)}</span></p>
  <p>&#9679; Balance (70%) due on completion: <span class="amt">${fmtCurrency(calc.total - calc.deposit)}</span></p>
  <p style="margin-top:8px;color:#ccc">${escHtml(bizTerms)}</p>
</div>

<h2>Full Quote</h2>
<div class="quote-body">${escHtml(quoteText)}</div>

<div class="sig-section">
  <div class="sig-box">
    <div class="sig-label">Client Acceptance</div>
    <div class="sig-line"></div>
    <div style="font-size:8pt;color:#aaa;margin-top:6px">Signature &amp; Date</div>
  </div>
  <div class="sig-box">
    <div class="sig-label">${escHtml(bizName)}</div>
    <div class="sig-line"></div>
    <div style="font-size:8pt;color:#aaa;margin-top:6px">Signature &amp; Date</div>
  </div>
</div>

<div class="footer">${escHtml(bizName)} &nbsp;|&nbsp; Thank you for your business</div>

</body>
</html>`;

  // Open print dialog in a new window
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) { showToast('Pop-up blocked — allow pop-ups to save PDF', 'error', 5000); return; }
  win.document.write(html);
  win.document.close();
  win.onload = () => {
    win.focus();
    win.print();
  };
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
