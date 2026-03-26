/**
 * Split-Flap Card for Home Assistant
 * A split-flap display card inspired by FlipOff (github.com/magnum6actual/flipoff)
 *
 * Installation:
 *   1. Copy this file to /config/www/splitflap-card.js
 *   2. Add as a resource in HA:
 *        Settings → Dashboards → ⋮ → Resources → Add
 *        URL: /local/splitflap-card.js   Type: JavaScript Module
 *   3. Create an input_text helper:
 *        Settings → Devices & Services → Helpers → Create → Text
 *        Name: "Splitflap Message"  (entity: input_text.splitflap_message)
 *        Max length: 132 (6 rows × 22 cols)
 *   4. Add the card to a dashboard (use YAML or visual editor)
 *
 * Minimal YAML:
 *   type: custom:splitflap-card
 *   entity: input_text.splitflap_message
 *
 * Full YAML options:
 *   type: custom:splitflap-card
 *   entity: input_text.splitflap_message
 *   title: ""                   # optional heading above the board
 *   rows: 6                     # default 6
 *   columns: 22                 # default 22
 *   font_size: auto             # "auto" scales to card, or px value e.g. "24px"
 *   scramble_duration: 600      # ms per tile scramble animation
 *   stagger_delay: 25           # ms stagger between tiles
 *   sound: false                # enable click sound (default off)
 *   sound_type: "mechanical"    # "mechanical" (click+flutter+thud) or "soft" (gentle clack)
 *   accent_color: "#e8572a"     # top/bottom bar colour
 *   scramble_colors:            # colours shown during scramble
 *     - "#e8572a"
 *     - "#f5a623"
 *     - "#4a90d9"
 *     - "#7ed321"
 *     - "#bd10e0"
 *   word_wrap: true             # wrap words across rows (vs truncate)
 *   line_separator: "|"         # character to force a new line in message
 *
 * Pushing messages:
 *   - Set the input_text via the HA UI
 *   - Or call input_text.set_value in automations/scripts:
 *       service: input_text.set_value
 *       target:
 *         entity_id: input_text.splitflap_message
 *       data:
 *         value: "HELLO WORLD"
 *   - Use "|" (or your line_separator) for manual line breaks:
 *       value: "LINE ONE|LINE TWO|LINE THREE"
 */

const VALID_CHARS = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%&()-+=[]:;\'",.<>?/°';
const DEFAULT_SCRAMBLE_COLORS = ['#e8572a', '#f5a623', '#4a90d9', '#7ed321', '#bd10e0'];
const DEFAULT_ACCENT = '#e8572a';

class SplitflapCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
    this._currentGrid = null;
    this._animating = false;
    this._tiles = [];
    this._rendered = false;
    this._lastValue = null;
  }

  /* ── HA plumbing ─────────────────────────────────── */

  static getConfigElement() {
    return document.createElement('splitflap-card-editor');
  }

  static getStubConfig() {
    return {
      entity: '',
      rows: 6,
      columns: 22,
      scramble_duration: 600,
      stagger_delay: 25,
      sound: false,
      sound_type: 'mechanical',
      word_wrap: true,
      line_separator: '|',
      accent_color: DEFAULT_ACCENT,
    };
  }

  setConfig(config) {
    if (!config.entity) {
      throw new Error('Please define an entity (e.g. input_text.splitflap_message)');
    }
    this._config = {
      rows: 6,
      columns: 22,
      scramble_duration: 600,
      stagger_delay: 25,
      sound: false,
      sound_type: 'mechanical',
      word_wrap: true,
      line_separator: '|',
      accent_color: DEFAULT_ACCENT,
      scramble_colors: DEFAULT_SCRAMBLE_COLORS,
      font_size: 'auto',
      title: '',
      ...config,
    };
    this._rendered = false;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._rendered) this._render();

    const entityId = this._config.entity;
    const stateObj = hass.states[entityId];
    if (!stateObj) return;

    const value = (stateObj.state || '').toUpperCase();
    if (value !== this._lastValue) {
      this._lastValue = value;
      this._setMessage(value);
    }
  }

  getCardSize() {
    return this._config.rows + 1;
  }

  /* ── Rendering ───────────────────────────────────── */

  _render() {
    const c = this._config;
    const rows = c.rows;
    const cols = c.columns;
    const accent = c.accent_color;
    const scrambleColors = (c.scramble_colors || DEFAULT_SCRAMBLE_COLORS).map(
      (col, i) => `--sc${i}: ${col};`
    ).join(' ');

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          --accent: ${accent};
          --rows: ${rows};
          --cols: ${cols};
          ${scrambleColors}
        }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        .vb-wrap {
          background: #1a1a1a;
          border-radius: 12px;
          overflow: hidden;
          padding: 0;
          container-type: inline-size;
        }
        .vb-title {
          color: #aaa;
          font-family: 'Segoe UI', system-ui, sans-serif;
          font-size: 13px;
          font-weight: 500;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          padding: 12px 16px 0;
        }
        .vb-bar {
          height: 4px;
          background: linear-gradient(90deg,
            var(--accent) 0%, var(--accent) 30%,
            #f5a623 50%, #4a90d9 70%, #7ed321 100%);
          border-radius: 2px;
          margin: 8px 10px;
        }
        .vb-board {
          display: grid;
          grid-template-columns: repeat(var(--cols), 1fr);
          grid-template-rows: repeat(var(--rows), 1fr);
          gap: 3px;
          padding: 6px 10px;
          aspect-ratio: calc(var(--cols) * 1.0) / calc(var(--rows) * 1.45);
        }

        /* ── Tile ────────────────────────── */
        .tile {
          position: relative;
          background: #2c2c2c;
          border-radius: 3px;
          display: flex;
          align-items: center;
          justify-content: center;
          aspect-ratio: 1 / 1.45;
          overflow: hidden;
          transition: background-color 0.08s;
        }
        .tile::after {
          content: '';
          position: absolute;
          left: 0; right: 0;
          top: 49%; height: 1px;
          background: rgba(0,0,0,0.35);
          pointer-events: none;
          z-index: 2;
        }
        .tile-char {
          font-family: 'Courier New', 'Consolas', monospace;
          font-weight: 700;
          color: #f0f0f0;
          line-height: 1;
          user-select: none;
          z-index: 1;
          text-align: center;
        }

        /* auto-size font to container */
        .tile-char {
          font-size: ${c.font_size === 'auto' ? 'min(3.2cqi, 2.8vh)' : c.font_size};
        }

        /* scramble keyframes */
        @keyframes scrambleIn {
          0%   { transform: rotateX(90deg); opacity: 0; }
          40%  { transform: rotateX(-10deg); opacity: 1; }
          70%  { transform: rotateX(5deg); }
          100% { transform: rotateX(0deg); opacity: 1; }
        }
        .tile.flipping .tile-char {
          animation: scrambleIn 0.25s ease-out forwards;
        }
        .tile.flash {
          transition: background-color 0.06s;
        }

        /* bottom bar */
        .vb-bar-bottom {
          height: 4px;
          background: linear-gradient(90deg,
            #7ed321 0%, #4a90d9 30%,
            #f5a623 60%, var(--accent) 100%);
          border-radius: 2px;
          margin: 4px 10px 10px;
        }

        /* entity missing state */
        .vb-error {
          color: #ff6b6b;
          font-family: monospace;
          font-size: 13px;
          padding: 20px;
          text-align: center;
        }
      </style>

      <ha-card>
        <div class="vb-wrap">
          ${c.title ? `<div class="vb-title">${c.title}</div>` : ''}
          <div class="vb-bar"></div>
          <div class="vb-board" id="board"></div>
          <div class="vb-bar-bottom"></div>
        </div>
      </ha-card>
    `;

    // Build tile grid
    const board = this.shadowRoot.getElementById('board');
    this._tiles = [];
    this._currentGrid = [];
    for (let r = 0; r < rows; r++) {
      this._currentGrid[r] = [];
      for (let c2 = 0; c2 < cols; c2++) {
        const tile = document.createElement('div');
        tile.className = 'tile';
        const charEl = document.createElement('span');
        charEl.className = 'tile-char';
        charEl.textContent = ' ';
        tile.appendChild(charEl);
        board.appendChild(tile);
        this._tiles.push({ el: tile, charEl, row: r, col: c2 });
        this._currentGrid[r][c2] = ' ';
      }
    }

    this._rendered = true;

    // If we already have a value queued, display it
    if (this._lastValue !== null) {
      this._setMessage(this._lastValue);
    }
  }

  /* ── Message layout ──────────────────────────────── */

  _messageToGrid(text) {
    const rows = this._config.rows;
    const cols = this._config.columns;
    const sep = this._config.line_separator;
    const wrap = this._config.word_wrap;

    // Split into lines by separator
    let lines = text.split(sep);

    // Word-wrap each line
    const wrappedLines = [];
    for (const line of lines) {
      if (!wrap) {
        wrappedLines.push(line.substring(0, cols));
      } else {
        const words = line.trim().split(/\s+/);
        let current = '';
        for (const word of words) {
          if (word.length > cols) {
            // Word longer than a row — just force it
            if (current) { wrappedLines.push(current); current = ''; }
            for (let i = 0; i < word.length; i += cols) {
              wrappedLines.push(word.substring(i, i + cols));
            }
          } else if (current.length === 0) {
            current = word;
          } else if (current.length + 1 + word.length <= cols) {
            current += ' ' + word;
          } else {
            wrappedLines.push(current);
            current = word;
          }
        }
        if (current) wrappedLines.push(current);
        if (line.trim() === '') wrappedLines.push('');
      }
    }

    // Centre vertically
    const usedRows = Math.min(wrappedLines.length, rows);
    const startRow = Math.floor((rows - usedRows) / 2);

    // Build grid
    const grid = [];
    for (let r = 0; r < rows; r++) {
      grid[r] = [];
      const lineIdx = r - startRow;
      const lineText = (lineIdx >= 0 && lineIdx < wrappedLines.length)
        ? wrappedLines[lineIdx] : '';
      // Centre horizontally
      const pad = Math.floor((cols - lineText.length) / 2);
      for (let c2 = 0; c2 < cols; c2++) {
        const charIdx = c2 - pad;
        const ch = (charIdx >= 0 && charIdx < lineText.length) ? lineText[charIdx] : ' ';
        grid[r][c2] = VALID_CHARS.includes(ch) ? ch : ' ';
      }
    }
    return grid;
  }

  /* ── Animation engine ────────────────────────────── */

  _setMessage(text) {
    if (!this._rendered || !this._tiles.length) return;
    const newGrid = this._messageToGrid(text);
    this._animateTransition(newGrid);
  }

  _animateTransition(newGrid) {
    const duration = this._config.scramble_duration;
    const stagger = this._config.stagger_delay;
    const colors = this._config.scramble_colors || DEFAULT_SCRAMBLE_COLORS;
    const rows = this._config.rows;
    const cols = this._config.columns;

    // Collect tiles that need to change
    const changes = [];
    for (let r = 0; r < rows; r++) {
      for (let c2 = 0; c2 < cols; c2++) {
        if (this._currentGrid[r][c2] !== newGrid[r][c2]) {
          changes.push({ r, c2, target: newGrid[r][c2] });
        }
      }
    }

    if (changes.length === 0) return;

    // Pre-schedule sounds using Web Audio API clock for precise timing
    if (this._config.sound && changes.length > 0) {
      this._scheduleFlipSounds(changes.length, stagger, duration);
    }

    // Animate each changed tile with stagger
    changes.forEach((ch, idx) => {
      const tileIdx = ch.r * cols + ch.c2;
      const tile = this._tiles[tileIdx];
      const delay = idx * stagger;
      const scrambleSteps = Math.floor(duration / 60);

      setTimeout(() => {
        this._scrambleTile(tile, ch.target, scrambleSteps, colors);
      }, delay);
    });

    // Update current grid immediately (for next comparison)
    for (let r = 0; r < rows; r++) {
      for (let c2 = 0; c2 < cols; c2++) {
        this._currentGrid[r][c2] = newGrid[r][c2];
      }
    }
  }

  _scrambleTile(tile, targetChar, steps, colors) {
    let step = 0;
    const interval = setInterval(() => {
      if (step >= steps) {
        clearInterval(interval);
        tile.charEl.textContent = targetChar;
        tile.el.style.backgroundColor = '';
        tile.el.classList.add('flipping');
        setTimeout(() => tile.el.classList.remove('flipping'), 260);
        return;
      }
      // Random char + random colour flash
      const randChar = VALID_CHARS[Math.floor(Math.random() * VALID_CHARS.length)];
      const randColor = colors[Math.floor(Math.random() * colors.length)];
      tile.charEl.textContent = randChar;
      tile.el.style.backgroundColor = randColor;
      step++;
    }, 60);
  }

  /* ── Sound engine (Web Audio API synthesis) ──────── */

  _getAudioCtx() {
    if (!this._audioCtx) {
      this._audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (this._audioCtx.state === 'suspended') {
      this._audioCtx.resume();
    }
    return this._audioCtx;
  }

  _noiseBuffer(duration) {
    const ctx = this._getAudioCtx();
    const len = ctx.sampleRate * duration;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /**
   * Pre-schedule all tile landing sounds up front using the Web Audio clock.
   * Each tile lands at: (index * stagger_delay) + scramble_duration ms from now.
   * We thin out sounds so only every Nth tile clicks — avoids audio mush
   * while still giving the cascading rattle effect.
   */
  _scheduleFlipSounds(tileCount, staggerMs, durationMs) {
    try {
      const ctx = this._getAudioCtx();
      const now = ctx.currentTime;
      const staggerSec = staggerMs / 1000;
      const durationSec = durationMs / 1000;

      // Thin out: play a sound every Nth tile, but at least 8-12 sounds total
      // so it still sounds like a cascading rattle
      const targetSounds = Math.min(tileCount, Math.max(8, Math.ceil(tileCount / 3)));
      const every = Math.max(1, Math.floor(tileCount / targetSounds));

      // Pre-generate a shared noise buffer (reused across scheduled sounds)
      const sharedNoise = this._noiseBuffer(0.08);

      const type = this._config.sound_type || 'mechanical';

      for (let i = 0; i < tileCount; i += every) {
        // Sound fires when each tile starts its scramble animation
        const flipTime = now + (i * staggerSec);
        // Add tiny random jitter for realism (±5ms)
        const jitter = (Math.random() - 0.5) * 0.01;
        const t = flipTime + jitter;

        if (type === 'mechanical') {
          this._scheduleMechanical(ctx, sharedNoise, t);
        } else {
          this._scheduleSoft(ctx, sharedNoise, t);
        }
      }
    } catch (_) { /* audio not available */ }
  }

  _scheduleMechanical(ctx, noiseBuf, t) {
    // 1) Initial click — sharp filtered noise burst
    const clickSrc = ctx.createBufferSource();
    clickSrc.buffer = noiseBuf;
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.3, t);
    clickGain.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    const clickFilter = ctx.createBiquadFilter();
    clickFilter.type = 'bandpass';
    clickFilter.frequency.value = 3000 + Math.random() * 1000;
    clickFilter.Q.value = 1.5;
    clickSrc.connect(clickFilter).connect(clickGain).connect(ctx.destination);
    clickSrc.start(t); clickSrc.stop(t + 0.015);

    // 2) Flutter — flap spinning
    const flutterSrc = ctx.createBufferSource();
    flutterSrc.buffer = noiseBuf;
    const flutterGain = ctx.createGain();
    flutterGain.gain.setValueAtTime(0.0001, t + 0.008);
    flutterGain.gain.linearRampToValueAtTime(0.10, t + 0.018);
    flutterGain.gain.exponentialRampToValueAtTime(0.001, t + 0.055);
    const flutterFilter = ctx.createBiquadFilter();
    flutterFilter.type = 'bandpass';
    flutterFilter.frequency.value = 1800 + Math.random() * 600;
    flutterFilter.Q.value = 0.8;
    flutterSrc.connect(flutterFilter).connect(flutterGain).connect(ctx.destination);
    flutterSrc.start(t + 0.008); flutterSrc.stop(t + 0.06);

    // 3) Landing thud
    const thudOsc = ctx.createOscillator();
    thudOsc.type = 'sine';
    thudOsc.frequency.setValueAtTime(130 + Math.random() * 40, t + 0.045);
    thudOsc.frequency.exponentialRampToValueAtTime(55, t + 0.09);
    const thudGain = ctx.createGain();
    thudGain.gain.setValueAtTime(0.15, t + 0.045);
    thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.095);
    thudOsc.connect(thudGain).connect(ctx.destination);
    thudOsc.start(t + 0.045); thudOsc.stop(t + 0.1);

    // 4) Landing click
    const landSrc = ctx.createBufferSource();
    landSrc.buffer = noiseBuf;
    const landGain = ctx.createGain();
    landGain.gain.setValueAtTime(0.15, t + 0.048);
    landGain.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    const landFilter = ctx.createBiquadFilter();
    landFilter.type = 'highpass';
    landFilter.frequency.value = 2200 + Math.random() * 600;
    landSrc.connect(landFilter).connect(landGain).connect(ctx.destination);
    landSrc.start(t + 0.048); landSrc.stop(t + 0.065);
  }

  _scheduleSoft(ctx, noiseBuf, t) {
    // Soft clack
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.12, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.035);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1600 + Math.random() * 500;
    filter.Q.value = 0.6;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(t); src.stop(t + 0.04);

    // Soft thud
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(90 + Math.random() * 30, t + 0.02);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.06);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.08, t + 0.02);
    g2.gain.exponentialRampToValueAtTime(0.001, t + 0.06);
    osc.connect(g2).connect(ctx.destination);
    osc.start(t + 0.02); osc.stop(t + 0.07);
  }
}

/* ── Visual Config Editor ──────────────────────────── */

class SplitflapCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
  }

  setConfig(config) {
    this._config = { ...config };
    this._render();
  }

  _render() {
    const c = this._config;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; padding: 16px; }
        .row { margin-bottom: 12px; }
        label { display: block; font-weight: 500; margin-bottom: 4px; font-size: 13px; color: var(--primary-text-color); }
        input, select {
          width: 100%; padding: 8px; border-radius: 6px;
          border: 1px solid var(--divider-color, #ccc);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color); font-size: 14px;
        }
        .cols-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .hint { font-size: 11px; color: var(--secondary-text-color); margin-top: 2px; }
      </style>
      <div class="row">
        <label>Entity (input_text)</label>
        <input id="entity" value="${c.entity || ''}" placeholder="input_text.splitflap_message" />
      </div>
      <div class="row">
        <label>Title (optional)</label>
        <input id="title" value="${c.title || ''}" placeholder="" />
      </div>
      <div class="cols-2">
        <div class="row">
          <label>Rows</label>
          <input id="rows" type="number" value="${c.rows || 6}" min="1" max="20" />
        </div>
        <div class="row">
          <label>Columns</label>
          <input id="columns" type="number" value="${c.columns || 22}" min="4" max="44" />
        </div>
      </div>
      <div class="cols-2">
        <div class="row">
          <label>Scramble duration (ms)</label>
          <input id="scramble_duration" type="number" value="${c.scramble_duration || 600}" min="100" max="3000" />
        </div>
        <div class="row">
          <label>Stagger delay (ms)</label>
          <input id="stagger_delay" type="number" value="${c.stagger_delay || 25}" min="0" max="200" />
        </div>
      </div>
      <div class="row">
        <label>Line separator character</label>
        <input id="line_separator" value="${c.line_separator || '|'}" maxlength="1" />
        <div class="hint">Use this character in your message to force a new line</div>
      </div>
      <div class="row">
        <label>Accent colour</label>
        <input id="accent_color" type="color" value="${c.accent_color || DEFAULT_ACCENT}" />
      </div>
      <div class="cols-2">
        <div class="row">
          <label>Sound</label>
          <select id="sound">
            <option value="false" ${!c.sound || c.sound === 'false' ? 'selected' : ''}>Off</option>
            <option value="true" ${c.sound === true || c.sound === 'true' ? 'selected' : ''}>On</option>
          </select>
          <div class="hint">Tap card once on tablet to enable audio</div>
        </div>
        <div class="row">
          <label>Sound type</label>
          <select id="sound_type">
            <option value="mechanical" ${(c.sound_type || 'mechanical') === 'mechanical' ? 'selected' : ''}>Mechanical</option>
            <option value="soft" ${c.sound_type === 'soft' ? 'selected' : ''}>Soft</option>
          </select>
        </div>
      </div>
    `;

    // Wire up change events
    ['entity', 'title', 'rows', 'columns', 'scramble_duration', 'stagger_delay',
     'line_separator', 'accent_color', 'sound', 'sound_type'].forEach(key => {
      const el = this.shadowRoot.getElementById(key);
      if (!el) return;
      el.addEventListener('change', () => {
        let val;
        if (key === 'sound') {
          val = el.value === 'true';
        } else if (el.type === 'number') {
          val = parseInt(el.value, 10);
        } else {
          val = el.value;
        }
        this._config = { ...this._config, [key]: val };
        this.dispatchEvent(new CustomEvent('config-changed', {
          detail: { config: this._config },
        }));
      });
    });
  }
}

/* ── Register ──────────────────────────────────────── */

customElements.define('splitflap-card', SplitflapCard);
customElements.define('splitflap-card-editor', SplitflapCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'splitflap-card',
  name: 'Split-Flap Display',
  description: 'Split-flap display card with flip animations',
  preview: true,
  documentationURL: 'https://github.com/magnum6actual/flipoff',
});
