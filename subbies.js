'use strict';

// ── Subbies + Brick Prices + Materials Calculator — extracted from app.js ──────
let subbieEditId = null; // null = add mode, string = edit mode (subbie uuid)

function renderSubbiesTab() {
  const el = document.getElementById('subbiesContent');
  if (!el) return;

  const subbies = loadSubbies().sort((a, b) => (b.reliability || 0) - (a.reliability || 0));

  if (!subbies.length) {
    el.innerHTML = '<p class="table-empty" style="padding:24px 0">No subcontractors added yet. Click "+ Add Subbie" to get started.</p>';
    return;
  }

  const stars = n => '★'.repeat(n || 0) + '☆'.repeat(5 - (n || 0));

  el.innerHTML = `
    <div class="subbies-grid">
      ${subbies.map(s => `
        <div class="subbie-card" data-id="${escHtml(s.id)}">
          <div class="subbie-card-header">
            <span class="subbie-name">${escHtml(s.name)}</span>
            <span class="subbie-trade">${escHtml(s.trade || '—')}</span>
          </div>
          <div class="subbie-stats">
            <div class="subbie-stat"><span class="subbie-stat-lbl">Day Rate</span><span class="subbie-stat-val">$${escHtml(String(s.dayRate || '—'))}</span></div>
            <div class="subbie-stat"><span class="subbie-stat-lbl">Phone</span><span class="subbie-stat-val">${escHtml(s.phone || '—')}</span></div>
            <div class="subbie-stat"><span class="subbie-stat-lbl">Jobs</span><span class="subbie-stat-val">${escHtml(String(s.jobsWorked || 0))}</span></div>
          </div>
          <div class="subbie-ratings">
            <span class="subbie-rating-lbl">Reliability</span>
            <span class="subbie-stars subbie-stars--gold" title="${s.reliability || 0}/5">${stars(s.reliability)}</span>
            <span class="subbie-rating-lbl">Quality</span>
            <span class="subbie-stars subbie-stars--gold" title="${s.quality || 0}/5">${stars(s.quality)}</span>
          </div>
          ${s.notes ? `<div class="subbie-notes">${escHtml(s.notes)}</div>` : ''}
          <div class="subbie-actions">
            <button class="subbie-btn subbie-btn--edit" data-edit="${escHtml(s.id)}">Edit</button>
            <button class="subbie-btn subbie-btn--delete" data-delete="${escHtml(s.id)}">Delete</button>
          </div>
        </div>`).join('')}
    </div>`;

  el.querySelectorAll('[data-edit]').forEach(btn =>
    btn.addEventListener('click', () => openSubbieForm(btn.dataset.edit))
  );
  el.querySelectorAll('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => {
      if (!confirm('Delete this subcontractor?')) return;
      const arr = loadSubbies().filter(s => s.id !== btn.dataset.delete);
      saveSubbies(arr);
      renderSubbiesTab();
      showToast('Subcontractor deleted', 'info', 2000);
    })
  );
}

function openSubbieForm(editId = null) {
  subbieEditId = editId;
  const existing = editId ? loadSubbies().find(s => s.id === editId) : null;
  const v = existing || { name: '', trade: '', dayRate: '', phone: '', jobsWorked: 0, reliability: 3, quality: 3, notes: '' };

  let overlay = document.getElementById('subbieFormOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'subbieFormOverlay';
    overlay.className = 'ai-modal-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    document.body.appendChild(overlay);
  }

  overlay.innerHTML = `
    <div class="ai-modal">
      <div class="ai-modal-header">
        <span class="ai-modal-title">${editId ? 'Edit' : 'Add'} Subcontractor</span>
        <button class="btn-modal-close" id="subbieFormClose">&#10005;</button>
      </div>
      <div class="ai-modal-body">
        <div class="subbie-form">
          <div class="subbie-form-row">
            <label class="calc-label">Name *</label>
            <input id="sf_name" class="calc-input" value="${escHtml(v.name)}" placeholder="Full name" />
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">Trade</label>
            <input id="sf_trade" class="calc-input" value="${escHtml(v.trade || '')}" placeholder="e.g. Bricklayer, Plasterer" />
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">Day Rate ($)</label>
            <input id="sf_rate" class="calc-input" type="number" value="${escHtml(String(v.dayRate || ''))}" min="0" />
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">Phone</label>
            <input id="sf_phone" class="calc-input" value="${escHtml(v.phone || '')}" placeholder="04XX XXX XXX" />
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">Jobs Worked</label>
            <input id="sf_jobs" class="calc-input" type="number" value="${escHtml(String(v.jobsWorked || 0))}" min="0" />
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">Reliability (1–5)</label>
            <input id="sf_rely" class="calc-input" type="number" value="${v.reliability || 3}" min="1" max="5" />
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">Quality (1–5)</label>
            <input id="sf_qual" class="calc-input" type="number" value="${v.quality || 3}" min="1" max="5" />
          </div>
          <div class="subbie-form-row">
            <label class="calc-label">Notes</label>
            <textarea id="sf_notes" class="calc-input" rows="2" placeholder="Any notes…">${escHtml(v.notes || '')}</textarea>
          </div>
          <button class="calc-run-btn" id="subbieFormSave">${editId ? 'Save Changes' : 'Add Subcontractor'}</button>
        </div>
      </div>
    </div>`;

  overlay.classList.add('is-open');

  document.getElementById('subbieFormClose')?.addEventListener('click', () => overlay.classList.remove('is-open'));
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('is-open'); });

  document.getElementById('subbieFormSave')?.addEventListener('click', () => {
    const name = document.getElementById('sf_name')?.value.trim();
    if (!name) { showToast('Name is required', 'error'); return; }

    const arr = loadSubbies();
    const entry = {
      id:          editId || ('s' + Date.now()),
      name,
      trade:       document.getElementById('sf_trade')?.value.trim() || '',
      dayRate:     parseFloat(document.getElementById('sf_rate')?.value || 0) || 0,
      phone:       document.getElementById('sf_phone')?.value.trim() || '',
      jobsWorked:  parseInt(document.getElementById('sf_jobs')?.value || 0, 10) || 0,
      reliability: Math.min(5, Math.max(1, parseInt(document.getElementById('sf_rely')?.value || 3, 10))),
      quality:     Math.min(5, Math.max(1, parseInt(document.getElementById('sf_qual')?.value || 3, 10))),
      notes:       document.getElementById('sf_notes')?.value.trim() || '',
    };

    if (editId) {
      const idx = arr.findIndex(s => s.id === editId);
      if (idx !== -1) arr[idx] = entry; else arr.push(entry);
    } else {
      arr.push(entry);
    }

    saveSubbies(arr);
    overlay.classList.remove('is-open');
    renderSubbiesTab();
    showToast(editId ? 'Subcontractor updated' : 'Subcontractor added', 'success', 2000);
  });
}

// Wire up Add Subbie button
(function initSubbies() {
  const btn = document.getElementById('btnAddSubbie');
  if (btn) btn.addEventListener('click', () => openSubbieForm(null));
})();


// ═══════════════════════════════════════════════════════════════════════════════
// FEATURE 9 & 10 — MATERIALS CALCULATOR + BRICK PRICE TRACKER
// ═══════════════════════════════════════════════════════════════════════════════

function renderBrickPriceTracker() {
  const el = document.getElementById('financeBrickPrices');
  if (!el) return;

  const prices = loadBrickPrices();

  el.innerHTML = `
    <div class="brick-prices-wrap">
      <table class="brick-prices-table">
        <thead><tr>
          <th>Material</th>
          <th>Unit</th>
          <th style="text-align:right">Price</th>
          <th>Last Updated</th>
          <th></th>
        </tr></thead>
        <tbody>
          ${prices.map((p, i) => `<tr>
            <td>${escHtml(p.name)}</td>
            <td class="brick-prices-unit">${escHtml(p.unit)}</td>
            <td style="text-align:right" class="brick-prices-price">
              $<input type="number" class="brick-price-input" data-idx="${i}" value="${p.price}" min="0" step="1" />
            </td>
            <td class="brick-prices-date">${p.updated ? new Date(p.updated).toLocaleDateString('en-GB') : '—'}</td>
            <td><button class="brick-price-save-btn" data-save="${i}">&#10003; Update</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

  el.querySelectorAll('[data-save]').forEach(btn => {
    btn.addEventListener('click', () => {
      const i   = parseInt(btn.dataset.save, 10);
      const inp = el.querySelector(`[data-idx="${i}"]`);
      const val = parseFloat(inp?.value || 0);
      if (isNaN(val) || val < 0) { showToast('Invalid price', 'error'); return; }
      prices[i].price   = val;
      prices[i].updated = Date.now();
      saveBrickPrices(prices);
      renderBrickPriceTracker();
      showToast(`${prices[i].name} price updated`, 'success', 2000);
    });
  });
}

// ─── Materials Calculator Logic ───────────────────────────────────────────────

const BRICK_CONFIGS = {
  standard: { l: 0.230, h: 0.076, perM2Single: null },  // calculated
  block:    { l: 0.390, h: 0.190, perM2Single: null },
  jumbo:    { l: 0.290, h: 0.090, perM2Single: null },
};

function calcBricksPerM2(type, joint) {
  const cfg = BRICK_CONFIGS[type] || BRICK_CONFIGS.standard;
  const j   = (joint || 10) / 1000;
  return 1 / ((cfg.l + j) * (cfg.h + j));
}

function runMaterialsCalc() {
  const length   = parseFloat(document.getElementById('calcLength')?.value  || 0);
  const height   = parseFloat(document.getElementById('calcHeight')?.value  || 0);
  const thick    = document.getElementById('calcThickness')?.value || 'double';
  const brickType= document.getElementById('calcBrickType')?.value || 'standard';
  const bond     = document.getElementById('calcBond')?.value     || 'stretcher';
  const joint    = parseFloat(document.getElementById('calcJoint')?.value   || 10);
  const openings = parseFloat(document.getElementById('calcOpenings')?.value|| 0);

  if (!length || !height) {
    showToast('Please enter valid dimensions', 'error');
    return;
  }

  const wallArea = Math.max(0, (length * height) - openings);
  const resultsEl = document.getElementById('calcResults');
  const copyBtn   = document.getElementById('btnCopyCalc');
  if (!resultsEl) return;

  const tradeType = (typeof getTradeType === 'function') ? getTradeType() : 'bricklayer';
  const isBrick   = tradeType === 'bricklayer' || tradeType === 'block_layer';

  let resultText = '';
  let resultHtml = '';

  if (isBrick) {
    const skins     = thick === 'single' ? 1 : thick === 'block' ? 1 : 2;
    const bondMult  = bond === 'english' ? 1.1 : bond === 'flemish' ? 1.05 : 1.0;
    const perM2     = calcBricksPerM2(brickType, joint);
    const bricksNet = wallArea * perM2 * skins * bondMult;
    const bricksWaste = Math.ceil(bricksNet * 1.10);
    const mortarBags  = Math.ceil(bricksWaste * 0.022);
    const brickWeight = brickType === 'block' ? 12 : brickType === 'jumbo' ? 4.5 : 3.5;
    const totalWeightKg = Math.round(bricksWaste * brickWeight);
    const prices = loadBrickPrices();
    const brickPriceEntry  = brickType === 'block' ? prices[2] : prices[0];
    const mortarPriceEntry = prices[3];
    const brickCostPer1000 = brickPriceEntry  ? brickPriceEntry.price  : 1000;
    const mortarCostPerBag = mortarPriceEntry ? mortarPriceEntry.price :   14;
    const brickCost  = (bricksWaste / 1000) * brickCostPer1000;
    const mortarCost = mortarBags * mortarCostPerBag;
    const totalCost  = brickCost + mortarCost;
    const unitLabel  = brickType === 'block' ? 'Blocks' : brickType === 'jumbo' ? 'Jumbo Bricks' : 'Bricks';

    resultText = `Wall: ${length}m × ${height}m = ${wallArea.toFixed(1)} m² (net)\n` +
      `${unitLabel} required: ${bricksWaste.toLocaleString()} (incl. 10% wastage)\n` +
      `Mortar bags: ${mortarBags}\nTotal weight: ${(totalWeightKg / 1000).toFixed(1)} tonnes\n` +
      `Estimated ${unitLabel.toLowerCase()} cost: ${fmtCurrency(brickCost)}\n` +
      `Estimated mortar cost: ${fmtCurrency(mortarCost)}\nTOTAL ESTIMATE: ${fmtCurrency(totalCost)}`;

    resultHtml = `
      <div class="calc-result-row"><span>Wall area (net)</span><strong>${wallArea.toFixed(1)} m²</strong></div>
      <div class="calc-result-row"><span>${unitLabel} (+ 10% wastage)</span><strong>${bricksWaste.toLocaleString()}</strong></div>
      <div class="calc-result-row"><span>Mortar bags (40kg)</span><strong>${mortarBags}</strong></div>
      <div class="calc-result-row"><span>Total weight</span><strong>${(totalWeightKg / 1000).toFixed(1)} t</strong></div>
      <div class="calc-result-divider"></div>
      <div class="calc-result-row"><span>${unitLabel} cost est.</span><strong>${fmtCurrency(brickCost)}</strong></div>
      <div class="calc-result-row"><span>Mortar cost est.</span><strong>${fmtCurrency(mortarCost)}</strong></div>
      <div class="calc-result-row calc-result-total"><span>TOTAL ESTIMATE</span><strong>${fmtCurrency(totalCost)}</strong></div>`;

  } else if (tradeType === 'painter') {
    // 1 litre covers ~12 m² per coat
    const litres1 = Math.ceil(wallArea / 12);
    const litres2 = litres1 * 2;
    resultText = `Area: ${wallArea.toFixed(1)} m²\nPaint (1 coat): ${litres1} L\nPaint (2 coats): ${litres2} L`;
    resultHtml = `
      <div class="calc-result-row"><span>Wall area (net)</span><strong>${wallArea.toFixed(1)} m²</strong></div>
      <div class="calc-result-divider"></div>
      <div class="calc-result-row"><span>Paint — 1 coat (12 m²/L)</span><strong>${litres1} L</strong></div>
      <div class="calc-result-row calc-result-total"><span>Paint — 2 coats</span><strong>${litres2} L</strong></div>`;

  } else if (tradeType === 'plasterer') {
    // 1 × 20kg bag covers ~5 m² at 10mm thickness (+10% wastage)
    const bags = Math.ceil((wallArea / 5) * 1.10);
    resultText = `Area: ${wallArea.toFixed(1)} m²\nPlaster bags (20kg, 10mm thick): ${bags}`;
    resultHtml = `
      <div class="calc-result-row"><span>Wall area (net)</span><strong>${wallArea.toFixed(1)} m²</strong></div>
      <div class="calc-result-divider"></div>
      <div class="calc-result-row calc-result-total"><span>Plaster bags (20kg, +10% wastage)</span><strong>${bags}</strong></div>`;

  } else if (tradeType === 'tiler') {
    // Standard 300mm tile: ~11 tiles/m² (+10% wastage)
    const tilesPerM2 = 1 / (0.300 * 0.300);
    const tiles = Math.ceil(wallArea * tilesPerM2 * 1.10);
    resultText = `Area: ${wallArea.toFixed(1)} m²\nTiles (300mm, +10% wastage): ${tiles.toLocaleString()}`;
    resultHtml = `
      <div class="calc-result-row"><span>Area (net)</span><strong>${wallArea.toFixed(1)} m²</strong></div>
      <div class="calc-result-divider"></div>
      <div class="calc-result-row calc-result-total"><span>Tiles 300mm (+ 10% wastage)</span><strong>${tiles.toLocaleString()}</strong></div>`;

  } else if (tradeType === 'pressure_cleaner') {
    resultText = `Total area to clean: ${wallArea.toFixed(1)} m²`;
    resultHtml = `
      <div class="calc-result-row calc-result-total"><span>Area to clean</span><strong>${wallArea.toFixed(1)} m²</strong></div>`;

  } else {
    // Generic: area + unit count at 1 unit/m²
    resultText = `Work area: ${wallArea.toFixed(1)} m²`;
    resultHtml = `
      <div class="calc-result-row calc-result-total"><span>Work area</span><strong>${wallArea.toFixed(1)} m²</strong></div>`;
  }

  resultsEl.innerHTML = resultHtml;

  if (copyBtn) {
    copyBtn.hidden = false;
    copyBtn.onclick = () => {
      navigator.clipboard.writeText(resultText).then(
        () => showToast('Quote copied to clipboard!', 'success'),
        () => showToast('Copy failed', 'error')
      );
    };
  }
}

(function initCalculator() {
  const btnOpen  = document.getElementById('btnCalculate');
  const overlay  = document.getElementById('calcOverlay');
  const closeBtn = document.getElementById('calcClose');
  const runBtn   = document.getElementById('btnRunCalc');
  if (!overlay) return;

  function updateCalcForTrade() {
    const tradeType = (typeof getTradeType === 'function') ? getTradeType() : 'bricklayer';
    const isBrick   = tradeType === 'bricklayer' || tradeType === 'block_layer';
    overlay.querySelectorAll('.calc-brick-only').forEach(el => {
      el.style.display = isBrick ? '' : 'none';
    });
  }

  if (btnOpen)  btnOpen.addEventListener('click',  () => { updateCalcForTrade(); overlay.classList.add('is-open'); });
  if (closeBtn) closeBtn.addEventListener('click', () => overlay.classList.remove('is-open'));
  if (runBtn)   runBtn.addEventListener('click',   runMaterialsCalc);
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.classList.remove('is-open'); });
})();

