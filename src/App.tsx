import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, FormEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import clsx from 'clsx';
import {
  Activity,
  Bell,
  Bolt,
  Car,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  CircleAlert,
  Cpu,
  Crown,
  Download,
  FileCog,
  FileText,
  FolderClock,
  FolderPlus,
  Gauge,
  Headphones,
  History,
  Home,
  Info,
  Leaf,
  Loader2,
  LockKeyhole,
  LogIn,
  Maximize2,
  Minus,
  Move,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Star,
  Upload,
  UserCircle,
  UserPlus,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {
  BuildJob,
  BuildMatch,
  Project,
  Subscription,
  User,
  clearToken,
  createBuild,
  createProject,
  downloadBuild,
  findBuildMatch,
  getBuild,
  getMe,
  getSubscription,
  listBuilds,
  listProjects,
  login,
  readToken,
  register,
} from './lib/api';

type PageKey = 'builder' | 'projects' | 'account';

const BASE_OPTIONS = [
  { key: 'STAGE1', label: 'Stage 1', hint: 'Balanced performance', icon: <Zap size={16} /> },
  { key: 'STAGE2', label: 'Stage 2', hint: 'Hardware-ready file', icon: <Bolt size={16} /> },
  { key: 'CUSTOM', label: 'Custom', hint: 'Special request', icon: <SlidersHorizontal size={16} /> },
  { key: 'ECO', label: 'ECO', hint: 'Efficiency tune', icon: <Leaf size={16} /> },
  { key: 'TCU', label: 'TCU', hint: 'Gearbox file', icon: <Gauge size={16} /> },
];

const ADDON_OPTIONS = [
  { key: 'EGR_OFF', label: 'EGR off', group: 'Emissions' },
  { key: 'DPF_OFF', label: 'DPF off', group: 'Emissions' },
  { key: 'GPF_OPF_OFF', label: 'GPF / OPF off', group: 'Emissions' },
  { key: 'DECAT', label: 'Decat', group: 'Emissions' },
  { key: 'ADBLUE_OFF', label: 'Adblue off', group: 'Emissions' },
  { key: 'NOX_OFF', label: 'NOx off', group: 'Emissions' },
  { key: 'SWIRL_FLAPS_OFF', label: 'Swirl flaps off', group: 'Drivability' },
  { key: 'MAF_OFF', label: 'MAF off', group: 'Drivability' },
  { key: 'LAMBDA_OFF', label: 'Lambda off', group: 'Drivability' },
  { key: 'START_STOP_OFF', label: 'Start / stop off', group: 'Comfort' },
  { key: 'TORQUE_MONITORING_OFF', label: 'Torque monitoring off', group: 'Protection' },
  { key: 'HOT_START_FIX', label: 'Hot start fix', group: 'Fixes' },
  { key: 'DTC_REMOVE', label: 'DTC removal', group: 'Fixes' },
  { key: 'POPS_BANGS', label: 'Pops & Bangs', group: 'Performance' },
  { key: 'VMAX', label: 'V-max', group: 'Performance' },
];

const BASE_OPTION_LABELS = Object.fromEntries(BASE_OPTIONS.map((option) => [option.key, option.label]));
const ADDON_OPTION_LABELS = Object.fromEntries(ADDON_OPTIONS.map((option) => [option.key, option.label]));

type DesignCardKey = 'upload' | 'match' | 'results' | 'tuning' | 'summary';

type DesignCardConfig = {
  x: number;
  y: number;
  width: number;
  height: number;
  padding: number;
  radius: number;
  borderWidth: number;
  borderColor: string;
  background: string;
  innerBackground: string;
  textColor: string;
  mutedColor: string;
  titleColor: string;
  fontSize: number;
  titleSize: number;
  labelSize: number;
  contentGap: number;
  shadowOpacity: number;
};

type DesignLabConfig = {
  version: 1;
  global: {
    fontFamily: string;
    baseFontSize: number;
    titleFontSize: number;
    labelFontSize: number;
    workspacePaddingX: number;
    workspacePaddingY: number;
    headerHeight: number;
    sidebarWidth: number;
    gridGap: number;
    topRowHeight: number;
    lowerRowMinHeight: number;
    pageBackground: string;
    workspaceBackground: string;
    headerBackground: string;
    sidebarBackground: string;
    accentColor: string;
    textColor: string;
    mutedColor: string;
    cardColumnOne: number;
    cardColumnTwo: number;
    cardColumnThree: number;
  };
  cards: Record<DesignCardKey, DesignCardConfig>;
};

type WindowBounds = { x: number; y: number; width: number; height: number };

const DESIGN_CARD_KEYS: DesignCardKey[] = ['upload', 'match', 'results', 'tuning', 'summary'];
const DESIGN_CARD_LABELS: Record<DesignCardKey, string> = {
  upload: 'Upload original ECU file',
  match: 'Match file',
  results: 'File match results',
  tuning: 'Tuning versions & options',
  summary: 'Summary & download',
};
const DESIGN_LAB_STORAGE_KEY = 'apex-files-design-lab-config';

const DEFAULT_DESIGN_CARD: DesignCardConfig = {
  x: 0,
  y: 0,
  width: 0,
  height: 342,
  padding: 12,
  radius: 7,
  borderWidth: 1,
  borderColor: '#2f3a3d',
  background: '#151b1e',
  innerBackground: '#121719',
  textColor: '#f3f6f6',
  mutedColor: '#8f9daa',
  titleColor: '#f5f7f7',
  fontSize: 13,
  titleSize: 13,
  labelSize: 11,
  contentGap: 10,
  shadowOpacity: 0,
};

const DEFAULT_DESIGN_LAB_CONFIG: DesignLabConfig = {
  version: 1,
  global: {
    fontFamily: 'Roboto Condensed',
    baseFontSize: 13,
    titleFontSize: 13,
    labelFontSize: 11,
    workspacePaddingX: 18,
    workspacePaddingY: 10,
    headerHeight: 82,
    sidebarWidth: 236,
    gridGap: 8,
    topRowHeight: 342,
    lowerRowMinHeight: 332,
    pageBackground: '#05090a',
    workspaceBackground: '#05090a',
    headerBackground: '#0a1011',
    sidebarBackground: '#060b0c',
    accentColor: '#ff8a00',
    textColor: '#f3f6f6',
    mutedColor: '#8f9daa',
    cardColumnOne: 1.16,
    cardColumnTwo: 0.76,
    cardColumnThree: 1.24,
  },
  cards: {
    upload: { ...DEFAULT_DESIGN_CARD },
    match: { ...DEFAULT_DESIGN_CARD },
    results: { ...DEFAULT_DESIGN_CARD },
    tuning: { ...DEFAULT_DESIGN_CARD, height: 332 },
    summary: { ...DEFAULT_DESIGN_CARD, height: 332 },
  },
};

function cloneDesignConfig(config: DesignLabConfig): DesignLabConfig {
  return JSON.parse(JSON.stringify(config)) as DesignLabConfig;
}

function readDesignLabConfig(): DesignLabConfig {
  try {
    const raw = localStorage.getItem(DESIGN_LAB_STORAGE_KEY);
    if (!raw) return cloneDesignConfig(DEFAULT_DESIGN_LAB_CONFIG);
    const parsed = JSON.parse(raw) as Partial<DesignLabConfig>;
    if (parsed.version !== 1 || !parsed.global || !parsed.cards) return cloneDesignConfig(DEFAULT_DESIGN_LAB_CONFIG);
    return {
      version: 1,
      global: { ...DEFAULT_DESIGN_LAB_CONFIG.global, ...parsed.global },
      cards: DESIGN_CARD_KEYS.reduce(
        (acc, key) => ({
          ...acc,
          [key]: { ...DEFAULT_DESIGN_LAB_CONFIG.cards[key], ...(parsed.cards?.[key] || {}) },
        }),
        {} as Record<DesignCardKey, DesignCardConfig>,
      ),
    };
  } catch {
    return cloneDesignConfig(DEFAULT_DESIGN_LAB_CONFIG);
  }
}

function designLabJson(config: DesignLabConfig) {
  return JSON.stringify(config, null, 2);
}

function configFontFamily(fontFamily: string) {
  if (fontFamily === 'system-ui') return 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif';
  return `'${fontFamily}', system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
}

function designLabWindowHtml() {
  const cardKeys = JSON.stringify(DESIGN_CARD_KEYS);
  const cardLabels = JSON.stringify(DESIGN_CARD_LABELS);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Apex Design Lab</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #f4f6f7;
      background: #080d0f;
      font-family: Inter, Segoe UI, Arial, sans-serif;
      font-size: 13px;
      user-select: none;
    }
    .shell { min-height: 100vh; padding: 14px; }
    header {
      position: sticky;
      top: 0;
      z-index: 5;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 12px;
      align-items: center;
      margin: -14px -14px 12px;
      border-bottom: 1px solid rgba(255,255,255,.12);
      padding: 14px;
      background: rgba(8,13,15,.98);
      box-shadow: 0 10px 28px rgba(0,0,0,.35);
    }
    h1 { margin: 0; font-size: 20px; line-height: 1; }
    .hint { margin-top: 4px; color: #93a2ad; font-size: 12px; }
    .toolbar { display: flex; flex-wrap: wrap; gap: 8px; }
    button {
      min-height: 34px;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 7px;
      padding: 0 12px;
      color: #f4f6f7;
      background: #151c20;
      font: inherit;
      font-weight: 800;
      cursor: pointer;
    }
    button:hover { border-color: #ff8a00; }
    button:disabled { opacity: .45; cursor: not-allowed; }
    .primary { color: white; background: linear-gradient(180deg, #ff940a, #f05a00); }
    .sections { display: grid; gap: 12px; }
    section {
      border: 1px solid rgba(255,255,255,.12);
      border-radius: 9px;
      padding: 12px;
      background: #11181b;
    }
    h2 {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      margin: 0 0 10px;
      color: #f6f8f8;
      font-size: 14px;
      text-transform: uppercase;
    }
    .tabs {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px;
      margin-bottom: 10px;
    }
    .tabs button { min-height: 36px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .tabs button.selected { border-color: #ff8a00; background: rgba(255,138,0,.18); }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .grid.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    label.control {
      display: grid;
      gap: 6px;
      min-width: 0;
      color: #97a5af;
      font-size: 11px;
      font-weight: 900;
      text-transform: uppercase;
    }
    input, select, textarea {
      width: 100%;
      min-width: 0;
      height: 34px;
      border: 1px solid rgba(255,255,255,.14);
      border-radius: 7px;
      outline: none;
      padding: 0 10px;
      color: #f4f6f7;
      background: #0b1113;
      font: 600 13px Inter, Segoe UI, Arial, sans-serif;
      user-select: text;
    }
    input:focus, select:focus, textarea:focus { border-color: #ff8a00; box-shadow: 0 0 0 3px rgba(255,138,0,.16); }
    .color-control {
      grid-template-columns: 48px minmax(0, 1fr);
      align-items: end;
      gap: 6px 9px;
    }
    .color-control span { grid-column: 1 / -1; }
    input[type="color"] {
      width: 48px;
      height: 34px;
      padding: 2px;
      cursor: pointer;
    }
    textarea {
      height: 170px;
      resize: vertical;
      padding: 10px;
      font: 12px Consolas, Courier New, monospace;
      line-height: 1.45;
    }
    .status { color: #9fb0bc; font-size: 12px; }
    .footer-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
  </style>
</head>
<body>
  <div id="app" class="shell"></div>
  <script>
    const CARD_KEYS = ${cardKeys};
    const CARD_LABELS = ${cardLabels};
    const FONT_OPTIONS = ['Roboto Condensed', 'Inter', 'Segoe UI', 'Bahnschrift', 'Arial Narrow', 'Arial', 'Tahoma', 'system-ui'];
    let state = null;
    let copiedTimer = null;

    function send(type, payload) {
      window.opener && window.opener.postMessage({ source: 'apex-design-lab', type, ...(payload || {}) }, '*');
    }
    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }
    function control(label, kind, field, value, options) {
      const opts = options || {};
      if (opts.type === 'select') {
        return '<label class="control"><span>' + escapeHtml(label) + '</span><select data-kind="' + kind + '" data-field="' + field + '">' +
          opts.options.map((option) => '<option ' + (option === value ? 'selected' : '') + '>' + escapeHtml(option) + '</option>').join('') +
          '</select></label>';
      }
      return '<label class="control"><span>' + escapeHtml(label) + '</span><input type="number" data-kind="' + kind + '" data-field="' + field + '" value="' + escapeHtml(value) + '" min="' + (opts.min ?? '') + '" max="' + (opts.max ?? '') + '" step="' + (opts.step ?? 1) + '" /></label>';
    }
    function color(label, kind, field, value) {
      const safe = /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#000000';
      return '<label class="control color-control"><span>' + escapeHtml(label) + '</span><input type="color" data-kind="' + kind + '" data-field="' + field + '" value="' + safe + '" /><input data-kind="' + kind + '" data-field="' + field + '" value="' + escapeHtml(value) + '" /></label>';
    }
    function exportJson() {
      return JSON.stringify(state ? state.config : {}, null, 2);
    }
    function render() {
      if (!state) {
        document.getElementById('app').innerHTML = '<header><div><h1>Apex Design Lab</h1><div class="hint">Waiting for Apex Files...</div></div></header>';
        return;
      }
      const config = state.config;
      const global = config.global;
      const card = config.cards[state.selectedCard];
      const bounds = state.windowBounds || { width: 0, height: 0, x: 0, y: 0 };
      document.getElementById('app').innerHTML =
        '<header><div><h1>Apex Design Lab</h1><div class="hint">Changes stay applied when this window closes. Send the JSON when ready.</div></div>' +
        '<div class="toolbar"><button data-action="undo" ' + (!state.canUndo ? 'disabled' : '') + '>Undo</button><button data-action="redo" ' + (!state.canRedo ? 'disabled' : '') + '>Redo</button><button data-action="reset">Reset</button><button data-action="close">Close</button></div></header>' +
        '<div class="sections">' +
        '<section><h2>Window</h2><div class="grid">' +
          control('Window width', 'window', 'width', bounds.width || 0, { min: 900, max: 2600 }) +
          control('Window height', 'window', 'height', bounds.height || 0, { min: 700, max: 1600 }) +
          control('Window X', 'window', 'x', bounds.x || 0, { min: -3000, max: 3000 }) +
          control('Window Y', 'window', 'y', bounds.y || 0, { min: -3000, max: 3000 }) +
        '</div></section>' +
        '<section><h2>Global</h2><div class="grid">' +
          control('Font family', 'global', 'fontFamily', global.fontFamily, { type: 'select', options: FONT_OPTIONS }) +
          control('Base font', 'global', 'baseFontSize', global.baseFontSize, { min: 9, max: 24 }) +
          control('Title font', 'global', 'titleFontSize', global.titleFontSize, { min: 9, max: 30 }) +
          control('Label font', 'global', 'labelFontSize', global.labelFontSize, { min: 8, max: 20 }) +
          control('Header height', 'global', 'headerHeight', global.headerHeight, { min: 58, max: 140 }) +
          control('Sidebar width', 'global', 'sidebarWidth', global.sidebarWidth, { min: 150, max: 380 }) +
          control('Workspace pad X', 'global', 'workspacePaddingX', global.workspacePaddingX, { min: 0, max: 80 }) +
          control('Workspace pad Y', 'global', 'workspacePaddingY', global.workspacePaddingY, { min: 0, max: 80 }) +
          control('Grid gap', 'global', 'gridGap', global.gridGap, { min: 0, max: 40 }) +
          control('Top row height', 'global', 'topRowHeight', global.topRowHeight, { min: 220, max: 620 }) +
          control('Lower row height', 'global', 'lowerRowMinHeight', global.lowerRowMinHeight, { min: 220, max: 760 }) +
          control('Column 1', 'global', 'cardColumnOne', global.cardColumnOne, { min: .4, max: 2.6, step: .01 }) +
          control('Column 2', 'global', 'cardColumnTwo', global.cardColumnTwo, { min: .3, max: 2, step: .01 }) +
          control('Column 3', 'global', 'cardColumnThree', global.cardColumnThree, { min: .4, max: 2.8, step: .01 }) +
        '</div><div class="grid">' +
          color('Page background', 'global', 'pageBackground', global.pageBackground) +
          color('Workspace background', 'global', 'workspaceBackground', global.workspaceBackground) +
          color('Header background', 'global', 'headerBackground', global.headerBackground) +
          color('Sidebar background', 'global', 'sidebarBackground', global.sidebarBackground) +
          color('Accent', 'global', 'accentColor', global.accentColor) +
          color('Text', 'global', 'textColor', global.textColor) +
          color('Muted', 'global', 'mutedColor', global.mutedColor) +
        '</div></section>' +
        '<section><h2>Containers <span class="status">' + escapeHtml(CARD_LABELS[state.selectedCard]) + '</span></h2><div class="tabs">' +
          CARD_KEYS.map((key) => '<button data-card="' + key + '" class="' + (key === state.selectedCard ? 'selected' : '') + '">' + escapeHtml(CARD_LABELS[key]) + '</button>').join('') +
        '</div><div class="grid">' +
          control('X offset', 'card', 'x', card.x, { min: -800, max: 800 }) +
          control('Y offset', 'card', 'y', card.y, { min: -800, max: 800 }) +
          control('Width (0 auto)', 'card', 'width', card.width, { min: 0, max: 1600 }) +
          control('Height', 'card', 'height', card.height, { min: 120, max: 1000 }) +
          control('Padding', 'card', 'padding', card.padding, { min: 0, max: 80 }) +
          control('Radius', 'card', 'radius', card.radius, { min: 0, max: 40 }) +
          control('Border width', 'card', 'borderWidth', card.borderWidth, { min: 0, max: 8 }) +
          control('Content gap', 'card', 'contentGap', card.contentGap, { min: 0, max: 60 }) +
          control('Font size', 'card', 'fontSize', card.fontSize, { min: 8, max: 28 }) +
          control('Title size', 'card', 'titleSize', card.titleSize, { min: 8, max: 34 }) +
          control('Label size', 'card', 'labelSize', card.labelSize, { min: 8, max: 22 }) +
          control('Shadow', 'card', 'shadowOpacity', card.shadowOpacity, { min: 0, max: .9, step: .01 }) +
        '</div><div class="grid">' +
          color('Background', 'card', 'background', card.background) +
          color('Inner background', 'card', 'innerBackground', card.innerBackground) +
          color('Border color', 'card', 'borderColor', card.borderColor) +
          color('Text', 'card', 'textColor', card.textColor) +
          color('Muted', 'card', 'mutedColor', card.mutedColor) +
          color('Title', 'card', 'titleColor', card.titleColor) +
        '</div></section>' +
        '<section><h2>Export</h2><textarea id="export" readonly>' + escapeHtml(exportJson()) + '</textarea><div class="footer-actions"><button class="primary" data-action="copy">Copy JSON</button><button data-action="refresh">Refresh</button></div><div id="copyStatus" class="hint"></div></section>' +
        '</div>';
      wire();
    }
    function updateLocal(kind, field, value) {
      if (!state) return;
      if (kind === 'global') state.config.global[field] = value;
      if (kind === 'card') state.config.cards[state.selectedCard][field] = value;
      if (kind === 'window') state.windowBounds = { ...(state.windowBounds || {}), [field]: value };
      const exportBox = document.getElementById('export');
      if (exportBox) exportBox.value = exportJson();
    }
    function wire() {
      document.querySelectorAll('[data-action]').forEach((button) => {
        button.addEventListener('click', () => {
          const action = button.getAttribute('data-action');
          if (action === 'copy') {
            navigator.clipboard.writeText(exportJson());
            document.getElementById('copyStatus').textContent = 'Copied JSON.';
            clearTimeout(copiedTimer);
            copiedTimer = setTimeout(() => document.getElementById('copyStatus').textContent = '', 1400);
            return;
          }
          if (action === 'refresh') { send('request-state'); return; }
          send(action);
        });
      });
      document.querySelectorAll('[data-card]').forEach((button) => {
        button.addEventListener('click', () => send('select-card', { key: button.getAttribute('data-card') }));
      });
      document.querySelectorAll('input[data-kind], select[data-kind]').forEach((input) => {
        const handler = () => {
          const kind = input.getAttribute('data-kind');
          const field = input.getAttribute('data-field');
          let value = input.value;
          if (input.type === 'number') value = Number(value);
          if (input.type === 'text' && field && /color|background/i.test(field) && !/^#[0-9a-fA-F]{6}$/.test(value)) return;
          updateLocal(kind, field, value);
          if (kind === 'global') send('update-global', { patch: { [field]: value } });
          if (kind === 'card') send('update-card', { key: state.selectedCard, patch: { [field]: value } });
          if (kind === 'window') send('set-window-bounds', { bounds: { [field]: value } });
        };
        input.addEventListener('input', handler);
        input.addEventListener('change', handler);
      });
    }
    window.addEventListener('message', (event) => {
      const data = event.data || {};
      if (data.source !== 'apex-design-lab-host') return;
      state = data;
      const active = document.activeElement;
      if (active && ['INPUT', 'SELECT', 'TEXTAREA'].includes(active.tagName)) {
        const exportBox = document.getElementById('export');
        if (exportBox) exportBox.value = exportJson();
        return;
      }
      render();
    });
    window.addEventListener('beforeunload', () => send('closed'));
    render();
    send('request-state');
  </script>
</body>
</html>`;
}

function userFacingError(reason: unknown, fallback: string) {
  const message = reason instanceof Error ? reason.message : fallback;
  if (!message || /internal server error/i.test(message)) return fallback;
  return message;
}

function formatFileSize(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString()} KB`;
}

function formatPackageLabel(subscription: Subscription | null) {
  if (!subscription) return 'Package loading';
  if (subscription.monthly_file_limit >= 9999) return 'Unlimited files';
  const remaining = Math.max(0, subscription.monthly_file_limit - subscription.files_used_this_period);
  return `${remaining} files remaining`;
}

function vehicleBrand(value: string) {
  if (!value || value === 'Pending') return 'Pending';
  return value.split(/\s+/)[0] || value;
}

function vehicleModel(value: string) {
  if (!value || value === 'Pending') return 'Pending';
  const [, ...rest] = value.split(/\s+/);
  return rest.join(' ') || value;
}

function engineLabel(value: string) {
  if (!value || value === 'Pending') return 'Pending';
  return value.match(/\b\d(?:\.\d)?\s?(?:TDI|TFSI|TSI|CDI|HDI|D|I)\b/i)?.[0] || 'Matched file';
}

function softwareNumber(filename?: string) {
  if (!filename) return 'Pending';
  const withoutExtension = filename.replace(/\.[^.]+$/, '');
  return (
    withoutExtension.match(/\b[A-Z0-9]{2,}\d{3,}[A-Z0-9]*\b/i)?.[0]?.toUpperCase() ||
    withoutExtension.split(/[_\-\s]+/).find((part) => /\d{4,}/.test(part)) ||
    'Matched'
  );
}

function firstDisplayValue(...values: Array<string | null | undefined>) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text && text.toLowerCase() !== 'pending') return text;
  }
  return 'Pending';
}

function ApexLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={clsx('brand-lockup', compact && 'brand-lockup-compact')}>
      <img className="brand-image" src="/apex-logo.png" alt="" aria-hidden="true" />
      {!compact ? (
        <div className="brand-copy">
          <strong>Apex Files</strong>
          <span>Powered by Revtech</span>
        </div>
      ) : null}
    </div>
  );
}

function WindowActions() {
  const [maximized, setMaximized] = useState(false);

  async function toggleMaximize() {
    const result = await window.apex?.maximizeToggle();
    if (typeof result === 'boolean') setMaximized(result);
  }

  return (
    <div className="window-actions app-no-drag">
      <button type="button" aria-label="Notifications" title="Notifications">
        <Bell size={15} />
      </button>
      <button type="button" aria-label="Minimize" title="Minimize" onClick={() => void window.apex?.minimize()}>
        <Minus size={15} />
      </button>
      <button type="button" aria-label={maximized ? 'Restore' : 'Maximize'} title={maximized ? 'Restore' : 'Maximize'} onClick={() => void toggleMaximize()}>
        {maximized ? <Square size={13} /> : <Maximize2 size={14} />}
      </button>
      <button type="button" className="danger" aria-label="Close" title="Close" onClick={() => void window.apex?.close()}>
        <X size={15} />
      </button>
    </div>
  );
}

function TopChrome({ user, subscription }: { user: User | null; subscription?: Subscription | null }) {
  if (!user) {
    return (
      <>
        <div className="app-drag drag-strip" />
        <div className="top-chrome login-chrome">
          <WindowActions />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="app-drag app-header-drag" />
      <header className="app-header app-drag">
        <div className="header-brand">
          <ApexLogo />
          <div className="header-divider" />
          <span>Professional ECU Calibration. Unlimited Potential.</span>
        </div>
        <div className="header-actions app-no-drag">
          <div className="header-plan">
            <Crown size={28} />
            <div>
              <strong>{subscription?.plan_name || 'Pro unlimited'}</strong>
              <span>{subscription && subscription.monthly_file_limit < 9999 ? formatPackageLabel(subscription) : 'Unlimited Monthly Plan'}</span>
            </div>
            <i />
          </div>
          <div className="header-account">
            <UserCircle size={30} />
            <ChevronDown size={18} />
          </div>
          <WindowActions />
        </div>
      </header>
    </>
  );
}

function LoginParticles() {
  const particles = useMemo(
    () =>
      Array.from({ length: 72 }, (_, index) => ({
        id: index,
        left: (index * 7.8) % 100,
        top: (index * 11.4) % 100,
        size: 1.6 + (index % 4) * 0.7,
        duration: 3.4 + (index % 5) * 0.45,
        delay: (index % 9) * 0.38,
        opacity: 0.16 + (index % 4) * 0.04,
        tone:
          index % 9 === 0
            ? 'rgba(34, 211, 238, 0.32)'
            : index % 6 === 0
              ? 'rgba(249, 115, 22, 0.30)'
              : 'rgba(226, 232, 240, 0.24)',
      })),
    [],
  );

  return (
    <div className="login-particles" aria-hidden="true">
      {particles.map((particle) => (
        <span
          key={particle.id}
          style={
            {
              left: `${particle.left}%`,
              top: `${particle.top}%`,
              width: `${particle.size}px`,
              height: `${particle.size}px`,
              color: particle.tone,
              animationDuration: `${particle.duration}s`,
              animationDelay: `-${particle.delay}s`,
              '--particle-opacity': `${particle.opacity}`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

function LoginScreen({ onAuthed }: { onAuthed: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const user =
        mode === 'login'
          ? await login(email, password)
          : await register({ email, password, display_name: displayName, company_name: companyName });
      onAuthed(user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-screen">
      <LoginParticles />
      <section className="login-stack">
        <div className="login-brand">
          <ApexLogo />
          <span>Customer access</span>
        </div>
        <form className="login-card" onSubmit={onSubmit}>
          <div className="login-heading">
            <div className="login-icon">
              <LockKeyhole size={20} />
            </div>
            <div>
              <span>{mode === 'login' ? 'Customer gate' : 'New workspace'}</span>
              <h1>{mode === 'login' ? 'Log in with your account' : 'Create your account'}</h1>
              <p>{mode === 'login' ? 'Access file builds, projects and your package.' : 'Create an Apex Files tuner workspace.'}</p>
            </div>
          </div>

          <label>
            <span>Account</span>
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="text" autoComplete="username" />
          </label>
          {mode === 'register' ? (
            <div className="login-two-col">
              <label>
                <span>Name</span>
                <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
              </label>
              <label>
                <span>Company</span>
                <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
              </label>
            </div>
          ) : null}
          <label>
            <span>Password</span>
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </label>

          {error ? <div className="form-error">{error}</div> : null}

          <button className="primary-action" disabled={loading || !email || !password}>
            {loading ? <Loader2 className="spin" size={16} /> : mode === 'login' ? <LogIn size={16} /> : <UserPlus size={16} />}
            {mode === 'login' ? 'Log in' : 'Create account'}
          </button>
          <button type="button" className="quiet-action" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Create an account' : 'Back to login'}
          </button>
        </form>
      </section>
    </main>
  );
}

function Sidebar({
  active,
  onChange,
  subscription,
}: {
  active: PageKey;
  onChange: (page: PageKey) => void;
  subscription: Subscription | null;
}) {
  const items: { key: string; page: PageKey; label: string; icon: ReactNode; activeWhen?: PageKey; accent?: boolean }[] = [
    { key: 'dashboard', page: 'builder', label: 'Dashboard', icon: <Home size={20} />, accent: true },
    { key: 'file-service', page: 'builder', label: 'File Service', icon: <FileCog size={20} />, activeWhen: 'builder' },
    { key: 'my-files', page: 'projects', label: 'My Files', icon: <FolderClock size={20} />, activeWhen: 'projects' },
    { key: 'downloads', page: 'projects', label: 'Downloads', icon: <Download size={20} /> },
    { key: 'history', page: 'projects', label: 'History', icon: <History size={20} /> },
    { key: 'favorites', page: 'projects', label: 'Favorites', icon: <Star size={20} /> },
    { key: 'support', page: 'account', label: 'Support', icon: <Headphones size={20} /> },
    { key: 'settings', page: 'account', label: 'Settings', icon: <Settings size={20} />, activeWhen: 'account' },
  ];
  const planName = subscription?.monthly_file_limit && subscription.monthly_file_limit < 9999 ? subscription.plan_name : 'Unlimited';
  const renewDate = subscription ? new Date(subscription.period_ends_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Loading';

  return (
    <aside className="sidebar">
      <div className="sidebar-inner">
        <nav>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={clsx(item.activeWhen === active && 'active', item.accent && 'accent')}
              onClick={() => onChange(item.page)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="credits-card">
            <span>Credits</span>
            <strong>{planName}</strong>
            <small>Renews: {renewDate}</small>
            <button type="button" onClick={() => onChange('account')}>Manage Plan</button>
          </div>
          <div className="sidebar-version">
            <span>v0.1.0</span>
            <i />
            <span>Up to date</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function StatusBadge({ status }: { status: string }) {
  const ready = status === 'ready';
  const failed = status === 'failed';
  const label = ready ? 'Ready' : failed ? 'Needs attention' : status.replace(/_/g, ' ');
  return (
    <span className={clsx('status-badge', ready && 'ready', failed && 'failed')}>
      {ready ? <CheckCircle2 size={13} /> : failed ? <CircleAlert size={13} /> : <Activity size={13} />}
      {label}
    </span>
  );
}

function StepTitle({ index, title }: { index: number; title: string }) {
  return (
    <div className="step-title">
      <span className="step-index">{index}</span>
      <strong>{title}</strong>
    </div>
  );
}

function MatchInfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
  return (
    <div className="match-info-row">
      <span className="match-info-icon">{icon}</span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ModalShell({
  title,
  eyebrow,
  icon,
  onClose,
  children,
  footer,
}: {
  title: string;
  eyebrow: string;
  icon: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="modal-backdrop app-no-drag" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal-card">
        <div className="modal-heading">
          <div className="modal-icon">{icon}</div>
          <div>
            <span>{eyebrow}</span>
            <h2>{title}</h2>
          </div>
          <button type="button" className="icon-action modal-close" onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

function BuildDeliveryModal({
  job,
  onClose,
  onDownloaded,
  onSaved,
}: {
  job: BuildJob;
  onClose: () => void;
  onDownloaded: (jobId: string) => void;
  onSaved: () => void;
}) {
  const ready = job.status === 'ready';
  const failed = job.status === 'failed';
  const addonLabels = (job.requested_options?.addon_keys || []).map((key) => ADDON_OPTION_LABELS[key] || key).filter(Boolean);
  const [projectName, setProjectName] = useState(job.vehicle_label || job.result_filename || job.source_filename);
  const [vehicleLabel, setVehicleLabel] = useState(job.vehicle_label);
  const [ecuLabel, setEcuLabel] = useState(job.ecu_label);
  const [comments, setComments] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');

  async function downloadReadyFile() {
    if (!ready) return;
    setDownloading(true);
    setDownloadError('');
    try {
      await downloadBuild(job.id, job.result_filename);
      onDownloaded(job.id);
    } catch (error) {
      setDownloadError(userFacingError(error, 'Could not download this file. Please try again.'));
    } finally {
      setDownloading(false);
    }
  }

  async function saveToFiles() {
    if (!ready || !projectName.trim()) return;
    setSaving(true);
    setSaveError('');
    try {
      await createProject({
        name: projectName.trim(),
        vehicle_label: vehicleLabel.trim() || job.vehicle_label,
        ecu_label: ecuLabel.trim() || job.ecu_label,
        source_filename: job.result_filename || job.source_filename,
        source_sha256: job.result_sha256 || job.source_sha256,
        requested_options: {
          saved_from: 'delivery',
          build_id: job.id,
          source_filename: job.source_filename,
          source_sha256: job.source_sha256,
          result_filename: job.result_filename,
          result_sha256: job.result_sha256,
          base_tune: job.base_tune,
          addon_keys: job.requested_options?.addon_keys || [],
          comments: comments.trim(),
        },
      });
      setSaved(true);
      onSaved();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save this project.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalShell
      eyebrow="Delivery"
      title={ready ? 'File ready' : failed ? 'Needs attention' : 'Preparing file'}
      icon={ready ? <CheckCircle2 size={18} /> : failed ? <CircleAlert size={18} /> : <Loader2 className="spin" size={18} />}
      onClose={onClose}
    >
      <div className="finished-summary">
        <div>
          <span>{ready ? 'Completed file' : 'Source file'}</span>
          <strong>{job.result_filename || job.source_filename}</strong>
        </div>
        <div>
          <span>Tune</span>
          <strong>{BASE_OPTION_LABELS[job.base_tune] || job.base_tune}</strong>
        </div>
        <div>
          <span>Options</span>
          <strong>{addonLabels.length ? addonLabels.join(', ') : 'None'}</strong>
        </div>
      </div>
      {job.error_message ? <div className="form-error">{job.error_message}</div> : null}
      {ready ? (
        <div className="delivery-save-form">
          <div className="success-panel">
            <CheckCircle2 size={18} />
            <span>Your file is ready to download or save to My Files.</span>
          </div>
          <label>
            <span>Project name</span>
            <input value={projectName} onChange={(event) => setProjectName(event.target.value)} />
          </label>
          <div className="delivery-save-grid">
            <label>
              <span>Vehicle</span>
              <input value={vehicleLabel} onChange={(event) => setVehicleLabel(event.target.value)} />
            </label>
            <label>
              <span>ECU</span>
              <input value={ecuLabel} onChange={(event) => setEcuLabel(event.target.value)} />
            </label>
          </div>
          <label>
            <span>Comments</span>
            <textarea value={comments} rows={4} onChange={(event) => setComments(event.target.value)} />
          </label>
          {saved ? (
            <div className="success-panel compact-success">
              <CheckCircle2 size={16} />
              <span>Saved to My Files.</span>
            </div>
          ) : null}
          {saveError ? <div className="form-error">{saveError}</div> : null}
        </div>
      ) : null}
      {downloadError ? <div className="form-error">{downloadError}</div> : null}
      <div className="modal-actions delivery-modal-actions">
        <button className="quiet-action" type="button" onClick={onClose}>
          Close
        </button>
        <button className="secondary-action" type="button" disabled={!ready || downloading} onClick={() => void downloadReadyFile()}>
          {downloading ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
          {ready ? 'Download again' : 'Preparing'}
        </button>
        <button className="primary-action" type="button" disabled={!ready || saving || !projectName.trim()} onClick={() => void saveToFiles()}>
          {saving ? <Loader2 className="spin" size={16} /> : <FolderPlus size={16} />}
          Save to My Files
        </button>
      </div>
    </ModalShell>
  );
}

function BuilderPage({
  onCreated,
  currentJob,
  deliveryReady,
  designMode,
  designActive,
  designConfig,
  selectedDesignCard,
  onSelectDesignCard,
  onDesignGlobalChange,
  onDesignCardChange,
  onDesignHistoryPoint,
  onOpenDelivery,
}: {
  onCreated: (job: BuildJob) => void;
  currentJob: BuildJob | null;
  deliveryReady: boolean;
  designMode: boolean;
  designActive: boolean;
  designConfig: DesignLabConfig;
  selectedDesignCard: DesignCardKey;
  onSelectDesignCard: (key: DesignCardKey) => void;
  onDesignGlobalChange: (patch: Partial<DesignLabConfig['global']>, recordHistory?: boolean) => void;
  onDesignCardChange: (key: DesignCardKey, patch: Partial<DesignCardConfig>, recordHistory?: boolean) => void;
  onDesignHistoryPoint: () => void;
  onOpenDelivery: () => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [matchResult, setMatchResult] = useState<BuildMatch | null>(null);
  const [baseTune, setBaseTune] = useState('');
  const [addons, setAddons] = useState<string[]>([]);
  const [vehicle, setVehicle] = useState('');
  const [ecu, setEcu] = useState('');
  const [matchLoading, setMatchLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function selectFile(nextFile: File | null) {
    setFile(nextFile);
    setMatchResult(null);
    setBaseTune('');
    setAddons([]);
    setError('');
  }

  function handleFileDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    selectFile(event.dataTransfer.files?.[0] || null);
  }

  function toggleAddon(key: string) {
    if (!matchResult?.addon_keys.includes(key)) return;
    setAddons((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  async function findMatch() {
    if (!file) return;
    setError('');
    setMatchResult(null);
    setBaseTune('');
    setAddons([]);
    setMatchLoading(true);
    try {
      const result = await findBuildMatch(file);
      setMatchResult(result);
      if (result.matched) {
        const firstBase = BASE_OPTIONS.find((option) => result.base_tunes.includes(option.key));
        setBaseTune(firstBase?.key || '');
        if (!vehicle.trim() && result.vehicle_label) setVehicle(result.vehicle_label);
        if (!ecu.trim() && result.ecu_label) setEcu(result.ecu_label);
      }
    } catch (reason) {
      setError(userFacingError(reason, 'Could not find a matching file. Please try again.'));
    } finally {
      setMatchLoading(false);
    }
  }

  async function submit() {
    if (!file || !matchResult?.matched || !baseTune) return;
    setError('');
    setLoading(true);
    try {
      const job = await createBuild({
        file,
        base_tune: baseTune,
        addon_keys: addons,
        vehicle_label: vehicle,
        ecu_label: ecu,
        save_project: false,
        project_name: vehicle || file.name,
      });
      onCreated(job);
    } catch (reason) {
      setError(userFacingError(reason, 'Could not start this file build. Please try again.'));
    } finally {
      setLoading(false);
    }
  }

  const availableBaseOptions = matchResult?.matched
    ? BASE_OPTIONS.filter((option) => matchResult.base_tunes.includes(option.key))
    : [];
  const availableAddonOptions = matchResult?.matched
    ? ADDON_OPTIONS.filter((option) => matchResult.addon_keys.includes(option.key))
    : [];
  const canBuild = Boolean(file && matchResult?.matched && baseTune && !loading && !matchLoading);
  const canOpenDelivery = Boolean(currentJob && deliveryReady && file && currentJob.source_filename === file.name);
  const matched = Boolean(matchResult?.matched);
  const selectedBaseLabel = baseTune ? BASE_OPTION_LABELS[baseTune] || baseTune : 'Pending';
  const selectedAddonLabels = addons.map((key) => ADDON_OPTION_LABELS[key] || key);
  const matchMetadata = matchResult?.metadata || {};
  const vehicleDisplay = firstDisplayValue(matchMetadata.vehicle, matchResult?.vehicle_label, vehicle);
  const brandDisplay = firstDisplayValue(matchMetadata.brand, vehicleBrand(vehicleDisplay));
  const modelDisplay = firstDisplayValue(matchMetadata.model, vehicleModel(vehicleDisplay));
  const engineDisplay = firstDisplayValue(matchMetadata.engine, matchMetadata.engine_code, engineLabel(vehicleDisplay));
  const ecuDisplay = firstDisplayValue(matchMetadata.ecu_type, matchResult?.ecu_label, ecu);
  const softwareDisplay = matched ? firstDisplayValue(matchMetadata.software_number, matchMetadata.calibration_id, softwareNumber(file?.name || matchResult?.source_filename)) : 'Pending';
  const hardwareDisplay = matched ? firstDisplayValue(matchMetadata.hardware_number, 'Matched') : 'Pending';
  const matchStatusText = matchLoading
    ? 'Analyzing file'
    : matched
      ? 'Match confirmed'
      : matchResult
        ? 'No matching version found'
        : file
          ? 'Ready to match'
          : 'Choose a file to start';
  const designVars = designActive
    ? ({
        '--design-font-family': configFontFamily(designConfig.global.fontFamily),
        '--design-base-font-size': `${designConfig.global.baseFontSize}px`,
        '--design-title-font-size': `${designConfig.global.titleFontSize}px`,
        '--design-label-font-size': `${designConfig.global.labelFontSize}px`,
        '--design-workspace-padding-x': `${designConfig.global.workspacePaddingX}px`,
        '--design-workspace-padding-y': `${designConfig.global.workspacePaddingY}px`,
        '--design-header-height': `${designConfig.global.headerHeight}px`,
        '--design-sidebar-width': `${designConfig.global.sidebarWidth}px`,
        '--design-grid-gap': `${designConfig.global.gridGap}px`,
        '--design-top-row-height': `${designConfig.global.topRowHeight}px`,
        '--design-lower-row-min-height': `${designConfig.global.lowerRowMinHeight}px`,
        '--design-page-bg': designConfig.global.pageBackground,
        '--design-workspace-bg': designConfig.global.workspaceBackground,
        '--design-header-bg': designConfig.global.headerBackground,
        '--design-sidebar-bg': designConfig.global.sidebarBackground,
        '--design-accent': designConfig.global.accentColor,
        '--design-text': designConfig.global.textColor,
        '--design-muted': designConfig.global.mutedColor,
        '--design-col-1': `${designConfig.global.cardColumnOne}fr`,
        '--design-col-2': `${designConfig.global.cardColumnTwo}fr`,
        '--design-col-3': `${designConfig.global.cardColumnThree}fr`,
      } as CSSProperties)
    : undefined;

  function designCardStyle(key: DesignCardKey): CSSProperties | undefined {
    if (!designActive) return undefined;
    const card = designConfig.cards[key];
    return {
      transform: `translate(${card.x}px, ${card.y}px)`,
      width: card.width ? `${card.width}px` : undefined,
      height: `${card.height}px`,
      minHeight: `${card.height}px`,
      padding: `${card.padding}px`,
      borderRadius: `${card.radius}px`,
      borderWidth: `${card.borderWidth}px`,
      borderColor: card.borderColor,
      background: card.background,
      color: card.textColor,
      fontSize: `${card.fontSize}px`,
      boxShadow: card.shadowOpacity ? `0 18px 54px rgba(0, 0, 0, ${card.shadowOpacity})` : 'none',
      '--design-card-inner-bg': card.innerBackground,
      '--design-card-text': card.textColor,
      '--design-card-muted': card.mutedColor,
      '--design-card-title': card.titleColor,
      '--design-card-title-size': `${card.titleSize}px`,
      '--design-card-label-size': `${card.labelSize}px`,
      '--design-card-gap': `${card.contentGap}px`,
    } as CSSProperties;
  }

  function startDesignDrag(key: DesignCardKey, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!designMode) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectDesignCard(key);
    onDesignHistoryPoint();
    const startX = event.clientX;
    const startY = event.clientY;
    const startCard = designConfig.cards[key];
    const onMove = (moveEvent: PointerEvent) => {
      onDesignCardChange(
        key,
        {
          x: Math.round(startCard.x + moveEvent.clientX - startX),
          y: Math.round(startCard.y + moveEvent.clientY - startY),
        },
        false,
      );
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function startDesignResize(key: DesignCardKey, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!designMode) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectDesignCard(key);
    onDesignHistoryPoint();
    const cardElement = event.currentTarget.closest('.service-card') as HTMLElement | null;
    const rect = cardElement?.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startCard = designConfig.cards[key];
    const startWidth = startCard.width || Math.round(rect?.width || 360);
    const startHeight = startCard.height || Math.round(rect?.height || 300);
    const onMove = (moveEvent: PointerEvent) => {
      onDesignCardChange(
        key,
        {
          width: Math.max(120, Math.round(startWidth + moveEvent.clientX - startX)),
          height: Math.max(120, Math.round(startHeight + moveEvent.clientY - startY)),
        },
        false,
      );
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function startRowResize(field: 'topRowHeight' | 'lowerRowMinHeight', event: ReactPointerEvent<HTMLButtonElement>) {
    if (!designMode) return;
    event.preventDefault();
    event.stopPropagation();
    onDesignHistoryPoint();
    const startY = event.clientY;
    const startValue = designConfig.global[field];
    const onMove = (moveEvent: PointerEvent) => {
      onDesignGlobalChange({ [field]: Math.max(160, Math.round(startValue + moveEvent.clientY - startY)) }, false);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }

  function designCardClass(key: DesignCardKey, className: string) {
    return clsx(className, designMode && 'design-editable-card', designMode && selectedDesignCard === key && 'design-selected-card');
  }

  function renderDesignHandle(cardKey: DesignCardKey) {
    if (!designMode) return null;
    return (
      <>
        <button
          type="button"
          className="design-card-handle app-no-drag"
          title={`Drag ${DESIGN_CARD_LABELS[cardKey]}`}
          onPointerDown={(event) => startDesignDrag(cardKey, event)}
          onClick={() => onSelectDesignCard(cardKey)}
        >
          <Move size={13} />
          <span>{DESIGN_CARD_LABELS[cardKey]}</span>
        </button>
        <button
          type="button"
          className="design-card-resize-handle app-no-drag"
          title={`Resize ${DESIGN_CARD_LABELS[cardKey]}`}
          onPointerDown={(event) => startDesignResize(cardKey, event)}
          onClick={() => onSelectDesignCard(cardKey)}
        >
          <Maximize2 size={13} />
        </button>
      </>
    );
  }

  return (
    <>
      <div className={clsx('builder-layout', designActive && 'design-lab-active')} style={designVars}>
        {designMode ? (
          <>
            <button
              type="button"
              className="design-row-resize-handle design-top-row-resize app-no-drag"
              style={{ top: `${designConfig.global.topRowHeight + designConfig.global.gridGap / 2}px` }}
              onPointerDown={(event) => startRowResize('topRowHeight', event)}
            >
              Top row {designConfig.global.topRowHeight}px
            </button>
            <button
              type="button"
              className="design-row-resize-handle design-lower-row-resize app-no-drag"
              style={{ top: `${designConfig.global.topRowHeight + designConfig.global.gridGap + designConfig.global.lowerRowMinHeight}px` }}
              onPointerDown={(event) => startRowResize('lowerRowMinHeight', event)}
            >
              Lower row {designConfig.global.lowerRowMinHeight}px
            </button>
          </>
        ) : null}
        <div className="file-service-grid">
          <section className={designCardClass('upload', 'service-card upload-service-card')} style={designCardStyle('upload')} onClick={() => designMode && onSelectDesignCard('upload')}>
            {renderDesignHandle('upload')}
            <StepTitle index={1} title="Upload original ECU file" />
            <input
              ref={fileInput}
              type="file"
              className="hidden-input"
              onChange={(event) => selectFile(event.target.files?.[0] || null)}
            />
            <button
              className={clsx('ecu-drop-target', file && 'has-file')}
              type="button"
              onClick={() => fileInput.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={handleFileDrop}
            >
              <span className="drop-cloud">
                <Upload size={34} />
              </span>
              <strong>Drag & drop your ECU file here</strong>
              <span>or</span>
              <em>Browse Files</em>
              <small>Supported formats: .bin .hex .ori .dat .ecu</small>
            </button>
            {file ? (
              <div className="file-strip">
                <FileText size={17} />
                <div>
                  <strong>{file.name}</strong>
                  <span>{formatFileSize(file.size)}</span>
                </div>
                <CheckCircle2 size={18} />
              </div>
            ) : null}
          </section>

          <section className={designCardClass('match', 'service-card match-service-card')} style={designCardStyle('match')} onClick={() => designMode && onSelectDesignCard('match')}>
            {renderDesignHandle('match')}
            <StepTitle index={2} title="Match file" />
            <div className={clsx('scanner-orb', matchLoading && 'scanning', matched && 'confirmed')} aria-hidden="true">
              <span className="scanner-ring one" />
              <span className="scanner-ring two" />
              <span className="scanner-core">
                {matchLoading ? <Loader2 className="spin" size={28} /> : matched ? <CheckCircle2 size={29} /> : <Search size={29} />}
              </span>
            </div>
            <p className="match-instruction">Click the button below to analyze and match your file.</p>
            <button className="match-action match-action-large" disabled={!file || matchLoading || loading} type="button" onClick={() => void findMatch()}>
              {matchLoading ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
              Match file
              <ChevronRight size={17} />
            </button>
            <div className={clsx('match-feedback', matched && 'confirmed', matchResult && !matched && 'failed')}>
              {matched ? <CheckCircle2 size={15} /> : matchResult && !matched ? <CircleAlert size={15} /> : <Info size={15} />}
              <div>
                <span>{matched ? 'File matched successfully' : matchStatusText}</span>
                {matched ? <small>Analysis completed</small> : null}
              </div>
            </div>
          </section>

          <section className={designCardClass('results', 'service-card results-service-card')} style={designCardStyle('results')} onClick={() => designMode && onSelectDesignCard('results')}>
            {renderDesignHandle('results')}
            <div className="card-title-row">
              <StepTitle index={3} title="File match results" />
              <span className={clsx('result-chip', matched && 'confirmed', matchResult && !matched && 'failed')}>
                {matched ? 'Match confirmed' : matchResult ? 'No match' : 'Waiting'}
              </span>
            </div>
            <div className="match-results-box">
              <div className="match-info-list">
                <MatchInfoRow icon={<Car size={15} />} label="Vehicle" value={vehicleDisplay} />
                <MatchInfoRow icon={<Car size={15} />} label="Brand" value={brandDisplay} />
                <MatchInfoRow icon={<Car size={15} />} label="Model" value={modelDisplay} />
                <MatchInfoRow icon={<Gauge size={15} />} label="Engine" value={engineDisplay} />
                <MatchInfoRow icon={<Cpu size={15} />} label="ECU Type" value={ecuDisplay} />
                <MatchInfoRow icon={<FileText size={15} />} label="Software Number" value={softwareDisplay} />
                <MatchInfoRow icon={<Cpu size={15} />} label="Hardware Number" value={hardwareDisplay} />
                <MatchInfoRow icon={<FileText size={15} />} label="File status" value={matched ? 'Original / stock' : 'Pending'} />
              </div>
            </div>
          </section>

          <section
            className={clsx(designCardClass('tuning', 'service-card tuning-service-card'), !matched && 'locked')}
            style={designCardStyle('tuning')}
            onClick={() => designMode && onSelectDesignCard('tuning')}
          >
            {renderDesignHandle('tuning')}
            <StepTitle index={4} title="Select tuning version & options" />
            {matched ? (
              <div className="tuning-config">
                <div className="stage-list">
                  <span className="block-label">Stage / version</span>
                  {availableBaseOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={clsx('stage-option', baseTune === option.key && 'selected')}
                      onClick={() => setBaseTune(option.key)}
                    >
                      <span>{baseTune === option.key ? <CheckCircle2 size={16} /> : option.icon}</span>
                      <div>
                        <strong>{option.label}</strong>
                        <small>{option.hint}</small>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="options-list">
                  <div className="block-row">
                    <span className="block-label">Additional options</span>
                    <span className="selection-count">{addons.length ? `${addons.length} selected` : 'None selected'}</span>
                  </div>
                  {availableAddonOptions.length ? (
                    <div className="addon-option-grid">
                      {availableAddonOptions.map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          className={clsx('addon-tile', addons.includes(option.key) && 'selected')}
                          onClick={() => toggleAddon(option.key)}
                        >
                          <span className="addon-state">{addons.includes(option.key) ? <CheckCircle2 size={14} /> : <Wrench size={14} />}</span>
                          <span className="addon-copy">
                            <strong>{option.label}</strong>
                            <small>{option.group}</small>
                          </span>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="option-empty inline-empty">
                      <Info size={15} />
                      <span>No add-ons are available for this matched file.</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="locked-card-message">
                <Search size={18} />
                <span>Find a match to unlock available versions and options.</span>
              </div>
            )}
          </section>

          <section className={designCardClass('summary', 'service-card summary-service-card')} style={designCardStyle('summary')} onClick={() => designMode && onSelectDesignCard('summary')}>
            {renderDesignHandle('summary')}
            <StepTitle index={5} title="Summary & download" />
            <div className="summary-download-box">
              <div className="selected-summary">
                <span>Selected summary</span>
                <ul>
                  <li>
                    <CheckCircle2 size={14} />
                    <strong>{selectedBaseLabel}</strong>
                    <small>{baseTune === 'STAGE1' ? '~180 HP / ~380 Nm' : baseTune === 'STAGE2' ? '~200 HP / ~420 Nm' : ''}</small>
                  </li>
                  {selectedAddonLabels.length ? (
                    selectedAddonLabels.map((label) => (
                      <li key={label}>
                        <CheckCircle2 size={14} />
                        <strong>{label}</strong>
                        <small>{ADDON_OPTIONS.find((option) => option.label === label)?.group || ''}</small>
                      </li>
                    ))
                  ) : (
                    <li>
                      <CheckCircle2 size={14} />
                      <strong>{matched ? 'No additional options' : 'Pending match'}</strong>
                      <small>{file?.name || ''}</small>
                    </li>
                  )}
                </ul>
                <div className="summary-meta">
                  <span>Estimated File Size:</span>
                  <strong>{file ? formatFileSize(file.size) : 'Pending'}</strong>
                  <span>Package Cost:</span>
                  <strong>Included</strong>
                  <span>Delivery:</span>
                  <strong>{matched ? 'Instant Download' : 'Pending'}</strong>
                </div>
              </div>
              {error ? <div className="form-error">{error}</div> : null}
              {matched ? (
                <button className="primary-action download-action" disabled={!canBuild} type="button" onClick={() => void submit()}>
                  {loading ? <Loader2 className="spin" size={17} /> : <Download size={17} />}
                  Download file
                </button>
              ) : (
                <div className="summary-waiting">
                  <Info size={15} />
                  <span>Download appears after a match is confirmed.</span>
                </div>
              )}
              <div className="safe-note">
                <ShieldCheck size={15} />
                <span>Files are checked and prepared securely.</span>
              </div>
              {canOpenDelivery ? (
                <button className="secondary-action compact delivery-action" type="button" onClick={onOpenDelivery}>
                  <Activity size={15} />
                  Open delivery
                </button>
              ) : null}
            </div>
          </section>

          <div className="service-proof-row">
            <div>
              <LockKeyhole size={17} />
              <strong>Secure workspace</strong>
              <span>Files stay inside your account.</span>
            </div>
            <div>
              <Zap size={17} />
              <strong>Fast delivery</strong>
              <span>Matched files are prepared immediately.</span>
            </div>
            <div>
              <ShieldCheck size={17} />
              <strong>Powered by Revtech</strong>
              <span>Apex experience, Revtech file data.</span>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function ProjectsPage({ projects, builds }: { projects: Project[]; builds: BuildJob[] }) {
  return (
    <section className="workspace-panel full-panel">
      <div className="section-heading">
        <div>
          <span>Saved work</span>
          <h2>Projects</h2>
        </div>
      </div>
      <div className="table-list">
        {projects.map((project) => {
          const build = builds.find((item) => item.id === project.last_build_id);
          return (
            <div className="table-row" key={project.id}>
              <div>
                <strong>{project.name}</strong>
                <span>{project.vehicle_label || project.source_filename || 'Unlabeled project'}</span>
              </div>
              <div>{project.ecu_label || 'ECU pending'}</div>
              <div>{build ? <StatusBadge status={build.status} /> : <span className="muted">No build yet</span>}</div>
            </div>
          );
        })}
        {!projects.length ? (
          <div className="empty-state slim">
            <FolderClock size={28} />
            <strong>No saved projects yet</strong>
            <span>Saved file builds will appear here.</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function AccountPage({ subscription, user }: { subscription: Subscription | null; user: User }) {
  const [tab, setTab] = useState<'profile' | 'package' | 'settings'>('profile');
  const used = subscription?.files_used_this_period || 0;
  const limit = subscription?.monthly_file_limit || 1;
  const unlimited = limit >= 9999;
  const percent = unlimited ? 0 : Math.min(100, Math.round((used / limit) * 100));

  return (
    <section className="workspace-panel full-panel">
      <div className="section-heading">
        <div>
          <span>Profile</span>
          <h2>Account and package</h2>
        </div>
        {subscription ? <StatusBadge status={subscription.status} /> : null}
      </div>
      <div className="account-tabs" role="tablist" aria-label="Account sections">
        {[
          { key: 'profile', label: 'Profile', icon: <ShieldCheck size={14} /> },
          { key: 'package', label: 'Package', icon: <Gauge size={14} /> },
          { key: 'settings', label: 'Settings', icon: <Settings size={14} /> },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            className={clsx(tab === item.key && 'selected')}
            onClick={() => setTab(item.key as typeof tab)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>
      <div className="account-layout">
        {tab === 'profile' ? (
          <>
            <div className="profile-block">
              <span>Signed in as</span>
              <strong>{user.display_name || user.email}</strong>
              <p>{user.company_name || user.email}</p>
            </div>
            <div className="profile-block">
              <span>Email</span>
              <strong>{user.email}</strong>
              <p>{user.role === 'admin' ? 'Administrator account' : 'Tuner account'}</p>
            </div>
          </>
        ) : null}
        {tab === 'package' ? (
          <>
            <div className="plan-block">
              <span>Current package</span>
              <strong>{subscription?.plan_name || 'Loading'}</strong>
              <p>{unlimited ? `${used} files processed this period` : `${used} of ${limit} files used this period`}</p>
            </div>
            <div className="usage-block account-wide">
              <div className="progress-bar large">
                <span style={{ width: `${unlimited ? 100 : percent}%` }} />
              </div>
              <div className="usage-meta">
                <span>{unlimited ? 'Unlimited package' : `${percent}% used`}</span>
                <span>{subscription ? `Renews ${new Date(subscription.period_ends_at).toLocaleDateString()}` : 'Loading renewal'}</span>
              </div>
            </div>
          </>
        ) : null}
        {tab === 'settings' ? (
          <div className="settings-grid">
            <label>
              <span>Default tune</span>
              <select defaultValue="STAGE1">
                {BASE_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Delivery name</span>
              <input defaultValue="Apex completed file" />
            </label>
            <label className="toggle-row setting-toggle">
              <input type="checkbox" defaultChecked />
              <span>Save projects by default</span>
            </label>
            <label className="toggle-row setting-toggle">
              <input type="checkbox" defaultChecked />
              <span>Notify when builds finish</span>
            </label>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function pageTitle(page: PageKey) {
  if (page === 'projects') return 'Projects';
  if (page === 'account') return 'Account';
  return 'File service';
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(readToken()));
  const [activePage, setActivePage] = useState<PageKey>('builder');
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [builds, setBuilds] = useState<BuildJob[]>([]);
  const [currentJob, setCurrentJob] = useState<BuildJob | null>(null);
  const [downloadedJobIds, setDownloadedJobIds] = useState<Set<string>>(() => new Set());
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [designMode, setDesignMode] = useState(false);
  const [designPreviewActive, setDesignPreviewActive] = useState(() => Boolean(localStorage.getItem(DESIGN_LAB_STORAGE_KEY)));
  const [designConfig, setDesignConfig] = useState<DesignLabConfig>(() => readDesignLabConfig());
  const [selectedDesignCard, setSelectedDesignCard] = useState<DesignCardKey>('upload');
  const [designPast, setDesignPast] = useState<DesignLabConfig[]>([]);
  const [designFuture, setDesignFuture] = useState<DesignLabConfig[]>([]);
  const [windowBounds, setWindowBounds] = useState<WindowBounds | null>(null);
  const lastReadyJobId = useRef<string | null>(null);
  const designWindowRef = useRef<Window | null>(null);

  async function refreshData() {
    const [subscriptionData, projectsData, buildsData] = await Promise.all([
      getSubscription().catch(() => null),
      listProjects().catch(() => []),
      listBuilds().catch(() => ({ items: [] })),
    ]);
    setSubscription(subscriptionData);
    setProjects(projectsData);
    setBuilds(buildsData.items);
    setCurrentJob((current) => {
      if (!current) return null;
      return buildsData.items.find((item) => item.id === current.id) || current;
    });
  }

  useEffect(() => {
    if (!readToken()) return;
    getMe()
      .then((nextUser) => {
        setUser(nextUser);
        return refreshData();
      })
      .catch(() => clearToken())
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!currentJob || ['ready', 'failed'].includes(currentJob.status)) return;
    const timer = window.setInterval(() => {
      getBuild(currentJob.id)
        .then((job) => {
          setCurrentJob(job);
          setBuilds((items) => [job, ...items.filter((item) => item.id !== job.id)]);
          if (['ready', 'failed'].includes(job.status)) void refreshData();
        })
        .catch(() => undefined);
    }, 2200);
    return () => window.clearInterval(timer);
  }, [currentJob]);

  useEffect(() => {
    if (currentJob?.status !== 'ready') return;
    if (lastReadyJobId.current === currentJob.id) return;
    lastReadyJobId.current = currentJob.id;
    setDeliveryOpen(true);
  }, [currentJob]);

  useEffect(() => {
    localStorage.setItem(DESIGN_LAB_STORAGE_KEY, designLabJson(designConfig));
  }, [designConfig]);

  const updateDesignConfig = useCallback((mutator: (draft: DesignLabConfig) => void, recordHistory = true) => {
    setDesignPreviewActive(true);
    setDesignConfig((current) => {
      const next = cloneDesignConfig(current);
      mutator(next);
      if (recordHistory) {
        setDesignPast((items) => [...items.slice(-59), cloneDesignConfig(current)]);
        setDesignFuture([]);
      }
      return next;
    });
  }, []);

  const markDesignHistoryPoint = useCallback(() => {
    setDesignPast((items) => [...items.slice(-59), cloneDesignConfig(designConfig)]);
    setDesignFuture([]);
  }, [designConfig]);

  const updateDesignGlobal = useCallback((patch: Partial<DesignLabConfig['global']>, recordHistory = true) => {
    updateDesignConfig((draft) => {
      draft.global = { ...draft.global, ...patch };
    }, recordHistory);
  }, [updateDesignConfig]);

  const updateDesignCard = useCallback((key: DesignCardKey, patch: Partial<DesignCardConfig>, recordHistory = true) => {
    updateDesignConfig((draft) => {
      draft.cards[key] = { ...draft.cards[key], ...patch };
    }, recordHistory);
  }, [updateDesignConfig]);

  const undoDesignChange = useCallback(() => {
    if (!designPast.length) return;
    const previous = designPast[designPast.length - 1];
    setDesignPast((items) => items.slice(0, -1));
    setDesignFuture((items) => [cloneDesignConfig(designConfig), ...items].slice(0, 60));
    setDesignConfig(cloneDesignConfig(previous));
  }, [designConfig, designPast]);

  const redoDesignChange = useCallback(() => {
    if (!designFuture.length) return;
    const next = designFuture[0];
    setDesignFuture((items) => items.slice(1));
    setDesignPast((items) => [...items.slice(-59), cloneDesignConfig(designConfig)]);
    setDesignConfig(cloneDesignConfig(next));
  }, [designConfig, designFuture]);

  const resetDesignConfig = useCallback(() => {
    updateDesignConfig((draft) => {
      Object.assign(draft, cloneDesignConfig(DEFAULT_DESIGN_LAB_CONFIG));
    });
    setSelectedDesignCard('upload');
  }, [updateDesignConfig]);

  const postDesignLabState = useCallback((target = designWindowRef.current) => {
    if (!target || target.closed) return;
    target.postMessage(
      {
        source: 'apex-design-lab-host',
        config: designConfig,
        selectedCard: selectedDesignCard,
        canUndo: Boolean(designPast.length),
        canRedo: Boolean(designFuture.length),
        windowBounds,
      },
      '*',
    );
  }, [designConfig, selectedDesignCard, designPast.length, designFuture.length, windowBounds]);

  useEffect(() => {
    if (!designMode) {
      if (designWindowRef.current && !designWindowRef.current.closed) designWindowRef.current.close();
      designWindowRef.current = null;
      return;
    }

    const popup = window.open('', 'apex-files-design-lab', 'width=560,height=960,left=60,top=60,resizable=yes,scrollbars=yes');
    if (!popup) return;
    designWindowRef.current = popup;
    popup.document.open();
    popup.document.write(designLabWindowHtml());
    popup.document.close();
    popup.focus();
    void window.apex?.getBounds().then((bounds) => {
      if (bounds) setWindowBounds(bounds);
    });
    const timer = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(timer);
        designWindowRef.current = null;
        setDesignMode(false);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [designMode]);

  useEffect(() => {
    postDesignLabState();
  }, [postDesignLabState]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data as {
        source?: string;
        type?: string;
        key?: DesignCardKey;
        patch?: Partial<DesignLabConfig['global']> | Partial<DesignCardConfig>;
        bounds?: Partial<WindowBounds>;
      };
      if (data?.source !== 'apex-design-lab') return;
      if (data.type === 'closed') {
        designWindowRef.current = null;
        setDesignMode(false);
        return;
      }
      if (data.type === 'close') {
        setDesignMode(false);
        return;
      }
      if (data.type === 'request-state') {
        void window.apex?.getBounds().then((bounds) => {
          if (bounds) setWindowBounds(bounds);
          window.setTimeout(() => postDesignLabState(), 0);
        });
        return;
      }
      if (data.type === 'select-card' && data.key && DESIGN_CARD_KEYS.includes(data.key)) {
        setSelectedDesignCard(data.key);
        return;
      }
      if (data.type === 'update-global' && data.patch) {
        updateDesignGlobal(data.patch as Partial<DesignLabConfig['global']>);
        return;
      }
      if (data.type === 'update-card' && data.key && DESIGN_CARD_KEYS.includes(data.key) && data.patch) {
        updateDesignCard(data.key, data.patch as Partial<DesignCardConfig>);
        return;
      }
      if (data.type === 'undo') {
        undoDesignChange();
        return;
      }
      if (data.type === 'redo') {
        redoDesignChange();
        return;
      }
      if (data.type === 'reset') {
        resetDesignConfig();
        return;
      }
      if (data.type === 'set-window-bounds' && data.bounds) {
        void window.apex?.setBounds(data.bounds).then((bounds) => {
          if (bounds) setWindowBounds(bounds);
        });
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [postDesignLabState, updateDesignGlobal, updateDesignCard, undoDesignChange, redoDesignChange, resetDesignConfig]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const commandKey = event.ctrlKey || event.metaKey;
      if (commandKey && event.shiftKey && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        setDesignMode((current) => {
          const next = !current;
          if (next) setDesignPreviewActive(true);
          return next;
        });
        return;
      }
      if (!designMode || !commandKey) return;
      if (event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undoDesignChange();
      }
      if (event.key.toLowerCase() === 'y' || (event.key.toLowerCase() === 'z' && event.shiftKey)) {
        event.preventDefault();
        redoDesignChange();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [designMode, designPast, designFuture, designConfig, undoDesignChange, redoDesignChange]);

  const page = useMemo(() => {
    if (activePage === 'projects') return <ProjectsPage projects={projects} builds={builds} />;
    if (activePage === 'account' && user) return <AccountPage subscription={subscription} user={user} />;
    return (
      <BuilderPage
        currentJob={currentJob}
        deliveryReady={Boolean(currentJob && downloadedJobIds.has(currentJob.id))}
        designMode={designMode}
        designActive={designPreviewActive}
        designConfig={designConfig}
        selectedDesignCard={selectedDesignCard}
        onSelectDesignCard={setSelectedDesignCard}
        onDesignGlobalChange={updateDesignGlobal}
        onDesignCardChange={updateDesignCard}
        onDesignHistoryPoint={markDesignHistoryPoint}
        onOpenDelivery={() => setDeliveryOpen(true)}
        onCreated={(job) => {
          setCurrentJob(job);
          setDeliveryOpen(true);
          setBuilds((items) => [job, ...items]);
          void refreshData();
        }}
      />
    );
  }, [
    activePage,
    builds,
    currentJob,
    downloadedJobIds,
    projects,
    subscription,
    user,
    designMode,
    designPreviewActive,
    designConfig,
    selectedDesignCard,
    updateDesignGlobal,
    updateDesignCard,
    markDesignHistoryPoint,
  ]);

  if (loading) {
    return (
      <div className="boot-screen">
        <ApexLogo />
        <Loader2 className="spin" size={22} />
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <TopChrome user={null} />
        <LoginScreen
          onAuthed={(nextUser) => {
            setUser(nextUser);
            void refreshData();
          }}
        />
      </>
    );
  }

  const filesLabel = formatPackageLabel(subscription);
  const designShellStyle = designPreviewActive
    ? ({
        '--design-font-family': configFontFamily(designConfig.global.fontFamily),
        '--design-base-font-size': `${designConfig.global.baseFontSize}px`,
        '--design-workspace-padding-x': `${designConfig.global.workspacePaddingX}px`,
        '--design-workspace-padding-y': `${designConfig.global.workspacePaddingY}px`,
        '--design-header-height': `${designConfig.global.headerHeight}px`,
        '--design-sidebar-width': `${designConfig.global.sidebarWidth}px`,
        '--design-page-bg': designConfig.global.pageBackground,
        '--design-workspace-bg': designConfig.global.workspaceBackground,
        '--design-header-bg': designConfig.global.headerBackground,
        '--design-sidebar-bg': designConfig.global.sidebarBackground,
        '--design-accent': designConfig.global.accentColor,
        '--design-text': designConfig.global.textColor,
        '--design-muted': designConfig.global.mutedColor,
      } as CSSProperties)
    : undefined;

  return (
    <div className={clsx('app-shell', designPreviewActive && 'app-shell-design-open')} style={designShellStyle}>
      <TopChrome user={user} subscription={subscription} />
      <Sidebar
        active={activePage}
        onChange={setActivePage}
        subscription={subscription}
      />
      <main className="workspace">
        {activePage !== 'builder' ? (
          <div className="workspace-heading">
            <div>
              <span>Apex workspace</span>
              <h1>{pageTitle(activePage)}</h1>
            </div>
            <div className="package-pill">
              <Gauge size={15} />
              {filesLabel}
            </div>
          </div>
        ) : null}
        {page}
      </main>
      {deliveryOpen && currentJob ? (
        <BuildDeliveryModal
          job={currentJob}
          onClose={() => setDeliveryOpen(false)}
          onDownloaded={(jobId) => {
            setDownloadedJobIds((current) => {
              const next = new Set(current);
              next.add(jobId);
              return next;
            });
          }}
          onSaved={() => {
            void refreshData();
          }}
        />
      ) : null}
    </div>
  );
}
