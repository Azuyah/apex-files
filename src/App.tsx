import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, FormEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import clsx from 'clsx';
import {
  Activity,
  Bell,
  Bolt,
  Car,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  CircleAlert,
  CloudUpload,
  Cpu,
  Crown,
  Download,
  Eye,
  FileCog,
  FileText,
  FolderClock,
  FolderPlus,
  Gauge,
  Headphones,
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
  UserCircle,
  UserPlus,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import packageJson from '../package.json';
import {
  BuildJob,
  BuildMatch,
  BuildScan,
  Project,
  Subscription,
  User,
  clearToken,
  createBuild,
  createProject,
  downloadBuild,
  getBuildScan,
  getBuild,
  getMe,
  getSubscription,
  listBuilds,
  listProjects,
  login,
  readToken,
  register,
  requestBuildFile,
  retryBuild,
  startBuildScan,
  updateProject,
} from './lib/api';

type PageKey = 'dashboard' | 'file-service' | 'my-files' | 'downloads' | 'packages' | 'support' | 'settings' | 'account';
const APP_VERSION = packageJson.version;

const BASE_OPTIONS = [
  { key: 'STAGE1', label: 'Stage 1', hint: '', icon: <Zap size={16} /> },
  { key: 'STAGE2', label: 'Stage 2', hint: '', icon: <Bolt size={16} /> },
  { key: 'CUSTOM', label: 'Custom', hint: 'Special request', icon: <SlidersHorizontal size={16} /> },
  { key: 'ECO', label: 'ECO', hint: 'Efficiency tune', icon: <Leaf size={16} /> },
  { key: 'TCU', label: 'TCU', hint: 'Gearbox file', icon: <Gauge size={16} /> },
];

const ADDON_OPTIONS = [
  { key: 'EGR_OFF', label: 'EGR off', group: 'Emissions', icon: <Wrench size={14} /> },
  { key: 'DPF_OFF', label: 'DPF off', group: 'Emissions', icon: <FileCog size={14} /> },
  { key: 'GPF_OPF_OFF', label: 'GPF / OPF off', group: 'Emissions', icon: <ShieldCheck size={14} /> },
  { key: 'DECAT', label: 'Decat', group: 'Emissions', icon: <Bolt size={14} /> },
  { key: 'ADBLUE_OFF', label: 'Adblue off', group: 'Emissions', icon: <FileCog size={14} /> },
  { key: 'NOX_OFF', label: 'NOx off', group: 'Emissions', icon: <Cpu size={14} /> },
  { key: 'SWIRL_FLAPS_OFF', label: 'Swirl flaps off', group: 'Drivability', icon: <Activity size={14} /> },
  { key: 'MAF_OFF', label: 'MAF off', group: 'Drivability', icon: <Gauge size={14} /> },
  { key: 'LAMBDA_OFF', label: 'Lambda off', group: 'Drivability', icon: <Settings size={14} /> },
  { key: 'START_STOP_OFF', label: 'Start / stop off', group: 'Comfort', icon: <Activity size={14} /> },
  { key: 'TORQUE_MONITORING_OFF', label: 'Torque monitoring off', group: 'Protection', icon: <ShieldCheck size={14} /> },
  { key: 'HOT_START_FIX', label: 'Hot start fix', group: 'Fixes', icon: <Zap size={14} /> },
  { key: 'DTC_REMOVE', label: 'DTC removal', group: 'Fixes', icon: <FileText size={14} /> },
  { key: 'POPS_BANGS', label: 'Pops & Bangs', group: 'Performance', icon: <Zap size={14} /> },
  { key: 'VMAX', label: 'V-max', group: 'Performance', icon: <Gauge size={14} /> },
];

const BASE_OPTION_LABELS = Object.fromEntries(BASE_OPTIONS.map((option) => [option.key, option.label]));
const ADDON_OPTION_LABELS = Object.fromEntries(ADDON_OPTIONS.map((option) => [option.key, option.label]));

function baseTuneLabel(key: string | null | undefined, emptyLabel = 'No stage selected') {
  const clean = String(key || '').trim();
  return clean ? BASE_OPTION_LABELS[clean] || clean : emptyLabel;
}

function displayScanStage(value: string | null | undefined) {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .replace(/\bSTAGE\s*1\b/gi, 'Stage 1')
    .replace(/\bSTAGE1\b/gi, 'Stage 1')
    .replace(/\bSTAGE\s*2\b/gi, 'Stage 2')
    .replace(/\bSTAGE2\b/gi, 'Stage 2');
}

type BuildableSelection = {
  signature: string;
  baseTune: string;
  addonKeys: string[];
  source: string;
  strategy: string;
};
type SelectionStatus = 'found' | 'candidate' | 'request';

function selectionSignature(baseTune: string | null | undefined, addonKeys: string[] | null | undefined) {
  const base = String(baseTune || '').trim().toUpperCase();
  const addons = Array.from(new Set((addonKeys || []).map((key) => String(key || '').trim().toUpperCase()).filter(Boolean))).sort();
  return `base=${base}|addons=${addons.join(',')}`;
}

function buildableSelections(match: BuildMatch | null | undefined): BuildableSelection[] {
  const availability = match?.availability as Record<string, unknown> | undefined;
  const rawSelections = Array.isArray(availability?.buildable_selections) ? availability.buildable_selections : [];
  return rawSelections.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    const baseTune = String(item.base_tune || '').trim().toUpperCase();
    const addonKeys = readStringArray(item.addon_keys).map((key) => key.toUpperCase()).sort();
    const signature = String(item.signature || selectionSignature(baseTune, addonKeys)).trim();
    if (!signature || (!baseTune && addonKeys.length === 0)) return [];
    return [{
      signature,
      baseTune,
      addonKeys,
      source: String(item.source || ''),
      strategy: String(item.strategy || ''),
    }];
  });
}

function candidateSelections(match: BuildMatch | null | undefined): BuildableSelection[] {
  const availability = match?.availability as Record<string, unknown> | undefined;
  const rawSelections = Array.isArray(availability?.candidate_selections) ? availability.candidate_selections : [];
  return rawSelections.flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const item = value as Record<string, unknown>;
    const baseTune = String(item.base_tune || '').trim().toUpperCase();
    const addonKeys = readStringArray(item.addon_keys).map((key) => key.toUpperCase()).sort();
    const signature = String(item.signature || selectionSignature(baseTune, addonKeys)).trim();
    if (!signature || (!baseTune && addonKeys.length === 0)) return [];
    return [{
      signature,
      baseTune,
      addonKeys,
      source: String(item.source || ''),
      strategy: String(item.strategy || ''),
    }];
  });
}

function isBuildableSelection(
  match: BuildMatch | null | undefined,
  baseTune: string | null | undefined,
  addonKeys: string[] | null | undefined,
) {
  const signature = selectionSignature(baseTune, addonKeys);
  const selections = buildableSelections(match);
  if (selections.length) return selections.some((selection) => selection.signature === signature);

  // Legacy scan payloads did not describe combinations. Preserve safe single-option
  // delivery, but never infer a multi-option build from a union of FOUND keys.
  const base = String(baseTune || '').trim().toUpperCase();
  const addons = readStringArray(addonKeys).map((key) => key.toUpperCase());
  if ((base ? 1 : 0) + addons.length !== 1) return false;
  if (base) return readStringArray(match?.base_tunes).includes(base);
  return readStringArray(match?.addon_keys).includes(addons[0]);
}

function isCandidateSelection(
  match: BuildMatch | null | undefined,
  baseTune: string | null | undefined,
  addonKeys: string[] | null | undefined,
) {
  const signature = selectionSignature(baseTune, addonKeys);
  return candidateSelections(match).some((selection) => selection.signature === signature);
}

type PackageKey = 'free' | 'lite' | 'pro';

const PACKAGE_OPTIONS: Array<{
  key: PackageKey;
  name: string;
  price: number;
  includedFiles: number | 'unlimited';
  extraFilePrice: number | null;
  customRequestPrice: number | null;
  eyebrow: string;
  description: string;
  icon: ReactNode;
  features: string[];
}> = [
  {
    key: 'free',
    name: 'Apex Free',
    price: 0,
    includedFiles: 1,
    extraFilePrice: 100,
    customRequestPrice: null,
    eyebrow: 'Starter',
    description: 'Try Apex with one included file every month.',
    icon: <Zap size={20} />,
    features: ['1 included file / month', '$100 per extra file', 'Database matches', 'Standard support'],
  },
  {
    key: 'lite',
    name: 'Apex Lite',
    price: 195,
    includedFiles: 20,
    extraFilePrice: 50,
    customRequestPrice: 90,
    eyebrow: 'Most flexible',
    description: 'For active tuners who want monthly volume and lower extra-file pricing.',
    icon: <Gauge size={20} />,
    features: ['20 included files / month', '$50 per extra file', '$90 custom file requests', 'Project history'],
  },
  {
    key: 'pro',
    name: 'Apex Pro',
    price: 399,
    includedFiles: 'unlimited',
    extraFilePrice: null,
    customRequestPrice: 75,
    eyebrow: 'Best value',
    description: 'Unlimited monthly file delivery with the lowest custom request price.',
    icon: <Crown size={20} />,
    features: ['Unlimited included files', '$75 custom file requests', 'Priority file delivery', 'Priority support'],
  },
];

function packageKeyFromSubscription(subscription: Subscription | null | undefined): PackageKey {
  const plan = String(subscription?.plan_name || '').toLowerCase();
  if (plan.includes('pro') || (subscription?.monthly_file_limit ?? 0) >= 9999) return 'pro';
  if (plan.includes('lite') || (subscription?.monthly_file_limit ?? 0) === 20) return 'lite';
  return 'free';
}

function packageNameFromKey(key: PackageKey) {
  return PACKAGE_OPTIONS.find((option) => option.key === key)?.name || 'Apex Free';
}

function displayPackageName(subscription: Subscription | null | undefined, user?: User | null) {
  if (!subscription) return user?.selected_package ? packageNameFromKey(user.selected_package as PackageKey) : 'Loading';
  return packageNameFromKey(packageKeyFromSubscription(subscription));
}

type DesignCardKey = 'upload' | 'match' | 'results' | 'tuning' | 'summary';
type DesignLoginKey = 'hero' | 'auth';
type DesignSurface = 'login' | 'file-service' | 'app-page';

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
  innerPaddingX: number;
  innerPaddingY: number;
  itemPaddingX: number;
  itemPaddingY: number;
  itemGap: number;
  itemMinHeight: number;
  itemLabelSize: number;
  itemValueSize: number;
  itemIconSize: number;
  itemValueOffset: number;
  stageBackground: string;
  stageBorderColor: string;
  stageSelectedBackground: string;
  stageSelectedBorderColor: string;
  optionBackground: string;
  optionBorderColor: string;
  optionSelectedBackground: string;
  optionSelectedBorderColor: string;
};

type DesignLabConfig = {
  version: 1;
  global: {
    fontFamily: string;
    fontBold: boolean;
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
    windowMinWidth: number;
    windowMinHeight: number;
    windowWidth: number;
    windowHeight: number;
  };
  cards: Record<DesignCardKey, DesignCardConfig>;
  login: Record<DesignLoginKey, DesignCardConfig>;
};

type WindowBounds = { x: number; y: number; width: number; height: number };

const DESIGN_CARD_KEYS: DesignCardKey[] = ['upload', 'match', 'results', 'tuning', 'summary'];
const DESIGN_LOGIN_KEYS: DesignLoginKey[] = ['hero', 'auth'];
const DESIGN_CARD_LABELS: Record<DesignCardKey, string> = {
  upload: 'Upload original ECU file',
  match: 'Scan file',
  results: 'Scan results',
  tuning: 'Tuning versions & options',
  summary: 'Match & delivery',
};
const DESIGN_LOGIN_LABELS: Record<DesignLoginKey, string> = {
  hero: 'Login hero / left content',
  auth: 'Login form',
};
const DESIGN_LAB_STORAGE_KEY = 'apex-files-design-lab-config-v13';
const DESIGN_TOP_ROW_CARDS: DesignCardKey[] = ['upload', 'match', 'results'];
const DESIGN_LOWER_ROW_CARDS: DesignCardKey[] = ['tuning', 'summary'];

const DEFAULT_DESIGN_CARD: DesignCardConfig = {
  x: 0,
  y: 0,
  width: 0,
  height: 315,
  padding: 12,
  radius: 7,
  borderWidth: 1,
  borderColor: '#2f3a3d',
  background: '#14171A',
  innerBackground: '#121719',
  textColor: '#f3f6f6',
  mutedColor: '#8f9daa',
  titleColor: '#f5f7f7',
  fontSize: 13,
  titleSize: 13,
  labelSize: 11,
  contentGap: 10,
  shadowOpacity: 0,
  innerPaddingX: 8,
  innerPaddingY: 4,
  itemPaddingX: 0,
  itemPaddingY: 0,
  itemGap: 4,
  itemMinHeight: 16,
  itemLabelSize: 10,
  itemValueSize: 11,
  itemIconSize: 11,
  itemValueOffset: 0,
  stageBackground: '#171d1f',
  stageBorderColor: '#2f3a3d',
  stageSelectedBackground: '#20201c',
  stageSelectedBorderColor: '#ff8a00',
  optionBackground: '#171d1f',
  optionBorderColor: '#2f3a3d',
  optionSelectedBackground: '#1c201e',
  optionSelectedBorderColor: '#ff8a00',
};

const DEFAULT_DESIGN_LAB_CONFIG: DesignLabConfig = {
  version: 1,
  global: {
    fontFamily: 'Inter',
    fontBold: false,
    baseFontSize: 12,
    titleFontSize: 12,
    labelFontSize: 10,
    workspacePaddingX: 18,
    workspacePaddingY: 10,
    headerHeight: 82,
    sidebarWidth: 236,
    gridGap: 8,
    topRowHeight: 357,
    lowerRowMinHeight: 406,
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
    windowMinWidth: 640,
    windowMinHeight: 420,
    windowWidth: 1670,
    windowHeight: 945,
  },
  cards: {
    upload: { ...DEFAULT_DESIGN_CARD, width: 476, height: 354, fontSize: 12, innerBackground: '#1E2023' },
    match: { ...DEFAULT_DESIGN_CARD, x: -27, width: 333, height: 355 },
    results: {
      ...DEFAULT_DESIGN_CARD,
      x: -21,
      width: 565,
      height: 355,
      innerBackground: '#131616',
      innerPaddingX: 8,
      innerPaddingY: 4,
      itemPaddingX: 0,
      itemPaddingY: 6,
      itemGap: 0,
      itemMinHeight: 16,
      itemLabelSize: 12,
      itemValueSize: 12,
      itemIconSize: 14,
      itemValueOffset: 80,
    },
    tuning: {
      ...DEFAULT_DESIGN_CARD,
      x: 1,
      width: 930,
      height: 402,
      stageSelectedBackground: '#1b1f20',
      optionBackground: '#191d1f',
      optionSelectedBackground: '#191d1f',
    },
    summary: { ...DEFAULT_DESIGN_CARD, x: 90, width: 453, height: 402, fontSize: 14, innerBackground: '#131616' },
  },
  login: {
    hero: {
      ...DEFAULT_DESIGN_CARD,
      y: -65,
      width: 620,
      height: 0,
      padding: 0,
      radius: 0,
      borderWidth: 0,
      borderColor: '#000000',
      background: 'transparent',
      innerBackground: 'transparent',
      fontSize: 14,
      titleSize: 54,
      labelSize: 11,
      contentGap: 18,
    },
    auth: {
      ...DEFAULT_DESIGN_CARD,
      width: 421,
      height: 0,
      padding: 21,
      radius: 10,
      borderColor: '#2f3a3d',
      background: '#080c0e',
      innerBackground: 'transparent',
      fontSize: 13,
      titleSize: 22,
      labelSize: 11,
      contentGap: 14,
      shadowOpacity: 0.5,
    },
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
      login: DESIGN_LOGIN_KEYS.reduce(
        (acc, key) => ({
          ...acc,
          [key]: { ...DEFAULT_DESIGN_LAB_CONFIG.login[key], ...(parsed.login?.[key] || {}) },
        }),
        {} as Record<DesignLoginKey, DesignCardConfig>,
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
  if (fontFamily === 'Helvetica') return 'Helvetica, Arial, sans-serif';
  return `'${fontFamily}', system-ui, -apple-system, BlinkMacSystemFont, sans-serif`;
}

function designLabWindowHtml() {
  const cardKeys = JSON.stringify(DESIGN_CARD_KEYS);
  const loginKeys = JSON.stringify(DESIGN_LOGIN_KEYS);
  const cardLabels = JSON.stringify(DESIGN_CARD_LABELS);
  const loginLabels = JSON.stringify(DESIGN_LOGIN_LABELS);
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
      font-family: Trebuchet MS, Helvetica, Arial, sans-serif;
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
    const LOGIN_KEYS = ${loginKeys};
    const CARD_LABELS = ${cardLabels};
    const LOGIN_LABELS = ${loginLabels};
    const FONT_OPTIONS = ['Inter', 'Helvetica', 'Arial', 'Segoe UI', 'Roboto', 'Verdana', 'Tahoma'];
    let state = null;
    let copiedTimer = null;
    let renderedSelectedCard = null;

    function send(type, payload) {
      window.opener && window.opener.postMessage({ source: 'apex-design-lab', type, ...(payload || {}) }, '*');
    }
    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }
    function activeSurface() {
      return state?.surface || 'file-service';
    }
    function activeKeys() {
      if (activeSurface() === 'login') return LOGIN_KEYS;
      if (activeSurface() === 'file-service') return CARD_KEYS;
      return [];
    }
    function activeLabels() {
      if (activeSurface() === 'login') return LOGIN_LABELS;
      if (activeSurface() === 'file-service') return CARD_LABELS;
      return {};
    }
    function activeCards() {
      if (!state) return {};
      if (activeSurface() === 'login') return state.config.login || {};
      return state.config.cards || {};
    }
    function activeSelectedCard() {
      const keys = activeKeys();
      if (!keys.length) return '';
      return keys.includes(state?.selectedCard) ? state.selectedCard : keys[0];
    }
    function surfaceTitle() {
      if (activeSurface() === 'login') return 'Login page';
      if (activeSurface() === 'file-service') return 'File service';
      return state?.surfaceLabel || 'Current page';
    }
    function control(label, kind, field, value, options) {
      const opts = options || {};
      if (opts.type === 'select') {
        return '<label class="control"><span>' + escapeHtml(label) + '</span><select data-kind="' + kind + '" data-field="' + field + '">' +
          opts.options.map((option) => '<option ' + (option === value ? 'selected' : '') + '>' + escapeHtml(option) + '</option>').join('') +
          '</select></label>';
      }
      if (opts.type === 'checkbox') {
        return '<label class="control checkbox-control"><span>' + escapeHtml(label) + '</span><input type="checkbox" data-kind="' + kind + '" data-field="' + field + '" ' + (value ? 'checked' : '') + ' /></label>';
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
      const keys = activeKeys();
      const labels = activeLabels();
      const selectedCard = activeSelectedCard();
      const card = selectedCard ? activeCards()[selectedCard] : null;
      renderedSelectedCard = selectedCard;
      const bounds = state.windowBounds || { width: 0, height: 0, x: 0, y: 0 };
      const windowWidth = global.windowWidth || bounds.width || 1670;
      const windowHeight = global.windowHeight || bounds.height || 945;
      const resultControls = activeSurface() === 'file-service' && selectedCard === 'results'
        ? '<div class="grid">' +
          control('Inner padding X', 'card', 'innerPaddingX', card.innerPaddingX, { min: 0, max: 40 }) +
          control('Inner padding Y', 'card', 'innerPaddingY', card.innerPaddingY, { min: 0, max: 40 }) +
          control('Item padding X', 'card', 'itemPaddingX', card.itemPaddingX, { min: 0, max: 30 }) +
          control('Item padding Y', 'card', 'itemPaddingY', card.itemPaddingY, { min: 0, max: 24 }) +
          control('Item gap', 'card', 'itemGap', card.itemGap, { min: 0, max: 24 }) +
          control('Item height', 'card', 'itemMinHeight', card.itemMinHeight, { min: 10, max: 48 }) +
          control('Label font', 'card', 'itemLabelSize', card.itemLabelSize, { min: 8, max: 22 }) +
          control('Value font', 'card', 'itemValueSize', card.itemValueSize, { min: 8, max: 24 }) +
          control('Icon size', 'card', 'itemIconSize', card.itemIconSize, { min: 8, max: 26 }) +
          control('Value spacing', 'card', 'itemValueOffset', card.itemValueOffset, { min: 0, max: 80 }) +
        '</div>'
        : '';
      const tuningControls = activeSurface() === 'file-service' && selectedCard === 'tuning'
        ? '<div class="grid">' +
          color('Stage background', 'card', 'stageBackground', card.stageBackground) +
          color('Stage border', 'card', 'stageBorderColor', card.stageBorderColor) +
          color('Stage selected background', 'card', 'stageSelectedBackground', card.stageSelectedBackground) +
          color('Stage selected border', 'card', 'stageSelectedBorderColor', card.stageSelectedBorderColor) +
          color('Option background', 'card', 'optionBackground', card.optionBackground) +
          color('Option border', 'card', 'optionBorderColor', card.optionBorderColor) +
          color('Option selected background', 'card', 'optionSelectedBackground', card.optionSelectedBackground) +
        '</div>'
        : '';
      const loginControls = activeSurface() === 'login' && card
        ? '<div class="grid">' +
          control('Inner padding X', 'card', 'innerPaddingX', card.innerPaddingX, { min: 0, max: 60 }) +
          control('Inner padding Y', 'card', 'innerPaddingY', card.innerPaddingY, { min: 0, max: 60 }) +
          control('Text offset', 'card', 'itemValueOffset', card.itemValueOffset, { min: -160, max: 240 }) +
        '</div>'
        : '';
      const containerSection = card
        ? '<section><h2>Containers <span class="status">' + escapeHtml(labels[selectedCard]) + '</span></h2><div class="tabs">' +
          keys.map((key) => '<button data-card="' + key + '" class="' + (key === selectedCard ? 'selected' : '') + '">' + escapeHtml(labels[key]) + '</button>').join('') +
        '</div><div class="grid">' +
          control('X offset', 'card', 'x', card.x, { min: -800, max: 800 }) +
          control('Y offset', 'card', 'y', card.y, { min: -800, max: 800 }) +
          control('Width (0 auto)', 'card', 'width', card.width, { min: 0, max: 1800 }) +
          control('Height (0 auto)', 'card', 'height', card.height, { min: 0, max: 1200 }) +
          control('Padding', 'card', 'padding', card.padding, { min: 0, max: 100 }) +
          control('Radius', 'card', 'radius', card.radius, { min: 0, max: 50 }) +
          control('Border width', 'card', 'borderWidth', card.borderWidth, { min: 0, max: 8 }) +
          control('Content gap', 'card', 'contentGap', card.contentGap, { min: 0, max: 80 }) +
          control('Font size', 'card', 'fontSize', card.fontSize, { min: 8, max: 32 }) +
          control('Title size', 'card', 'titleSize', card.titleSize, { min: 8, max: 72 }) +
          control('Label size', 'card', 'labelSize', card.labelSize, { min: 8, max: 24 }) +
          control('Shadow', 'card', 'shadowOpacity', card.shadowOpacity, { min: 0, max: .9, step: .01 }) +
        '</div><div class="grid">' +
          color('Background', 'card', 'background', card.background) +
          color('Inner background', 'card', 'innerBackground', card.innerBackground) +
          color('Border color', 'card', 'borderColor', card.borderColor) +
          color('Text', 'card', 'textColor', card.textColor) +
          color('Muted', 'card', 'mutedColor', card.mutedColor) +
          color('Title', 'card', 'titleColor', card.titleColor) +
        '</div>' + resultControls + tuningControls + loginControls + '</section>'
        : '<section><h2>Containers <span class="status">' + escapeHtml(surfaceTitle()) + '</span></h2><p class="status">This page only uses global/window controls right now. Open the File Service or Login page to edit page containers.</p></section>';
      document.getElementById('app').innerHTML =
        '<header><div><h1>Apex Design Lab</h1><div class="hint">' + escapeHtml(surfaceTitle()) + ' controls. Changes stay applied when this window closes.</div></div>' +
        '<div class="toolbar"><button data-action="undo" ' + (!state.canUndo ? 'disabled' : '') + '>Undo</button><button data-action="redo" ' + (!state.canRedo ? 'disabled' : '') + '>Redo</button><button data-action="reset">Reset</button><button data-action="close">Close</button></div></header>' +
        '<div class="sections">' +
        '<section><h2>Window</h2><div class="grid">' +
          control('Startup width', 'global', 'windowWidth', windowWidth, { min: global.windowMinWidth || 640, max: 2600 }) +
          control('Startup height', 'global', 'windowHeight', windowHeight, { min: global.windowMinHeight || 420, max: 1600 }) +
          control('Min width', 'global', 'windowMinWidth', global.windowMinWidth, { min: 640, max: 1800 }) +
          control('Min height', 'global', 'windowMinHeight', global.windowMinHeight, { min: 420, max: 1200 }) +
          control('Window X', 'window', 'x', bounds.x || 0, { min: -3000, max: 3000 }) +
          control('Window Y', 'window', 'y', bounds.y || 0, { min: -3000, max: 3000 }) +
        '</div></section>' +
        '<section><h2>Global</h2><div class="grid">' +
          control('Font family', 'global', 'fontFamily', global.fontFamily, { type: 'select', options: FONT_OPTIONS }) +
          control('Bold text', 'global', 'fontBold', global.fontBold, { type: 'checkbox' }) +
          control('Base font', 'global', 'baseFontSize', global.baseFontSize, { min: 9, max: 24 }) +
          control('Title font', 'global', 'titleFontSize', global.titleFontSize, { min: 9, max: 30 }) +
          control('Label font', 'global', 'labelFontSize', global.labelFontSize, { min: 8, max: 20 }) +
          control('Header height', 'global', 'headerHeight', global.headerHeight, { min: 58, max: 140 }) +
          control('Sidebar width', 'global', 'sidebarWidth', global.sidebarWidth, { min: 150, max: 380 }) +
          control('Workspace pad X', 'global', 'workspacePaddingX', global.workspacePaddingX, { min: 0, max: 80 }) +
          control('Workspace pad Y', 'global', 'workspacePaddingY', global.workspacePaddingY, { min: 0, max: 80 }) +
          control('Grid gap', 'global', 'gridGap', global.gridGap, { min: 0, max: 40 }) +
          control('Top row height', 'global', 'topRowHeight', global.topRowHeight, { min: 220, max: 620 }) +
          control('Lower row height (both cards)', 'global', 'lowerRowMinHeight', global.lowerRowMinHeight, { min: 220, max: 760 }) +
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
        containerSection +
        '<section><h2>Export</h2><textarea id="export" readonly>' + escapeHtml(exportJson()) + '</textarea><div class="footer-actions"><button class="primary" data-action="copy">Copy JSON</button><button data-action="refresh">Refresh</button></div><div id="copyStatus" class="hint"></div></section>' +
        '</div>';
      wire();
    }
    function updateLocal(kind, field, value) {
      if (!state) return;
      if (kind === 'global') state.config.global[field] = value;
      if (kind === 'card') {
        const selectedCard = activeSelectedCard();
        if (selectedCard && activeCards()[selectedCard]) activeCards()[selectedCard][field] = value;
      }
      if (kind === 'window') state.windowBounds = { ...(state.windowBounds || {}), [field]: value };
      const exportBox = document.getElementById('export');
      if (exportBox) exportBox.value = exportJson();
    }
    function controlValue(kind, field) {
      if (!state) return '';
      if (kind === 'global') return state.config.global[field];
      if (kind === 'card') {
        const selectedCard = activeSelectedCard();
        return selectedCard ? activeCards()[selectedCard]?.[field] : '';
      }
      if (kind === 'window') return (state.windowBounds || {})[field] ?? 0;
      return '';
    }
    function syncVisibleControls() {
        if (!state) return;
      document.querySelectorAll('input[data-kind], select[data-kind]').forEach((input) => {
        const kind = input.getAttribute('data-kind');
        const field = input.getAttribute('data-field');
        let value = controlValue(kind, field);
        if (input.type === 'checkbox') {
          input.checked = Boolean(value);
          return;
        }
        if (input.type === 'color') value = /^#[0-9a-fA-F]{6}$/.test(value || '') ? value : '#000000';
        const next = String(value ?? '');
        if (input.value !== next) input.value = next;
      });
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
          let value = input.type === 'checkbox' ? input.checked : input.value;
          if (input.type === 'number') value = Number(value);
          if (input.type === 'text' && field && /color|background/i.test(field) && !/^#[0-9a-fA-F]{6}$/.test(value)) return;
          updateLocal(kind, field, value);
          if (kind === 'global') send('update-global', { patch: { [field]: value } });
          if (kind === 'card') send('update-card', { surface: activeSurface(), key: activeSelectedCard(), patch: { [field]: value } });
          if (kind === 'window') send('set-window-bounds', { bounds: { [field]: value } });
          if (kind === 'global' && field === 'windowWidth') send('set-window-bounds', { bounds: { width: value } });
          if (kind === 'global' && field === 'windowHeight') send('set-window-bounds', { bounds: { height: value } });
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
        if (renderedSelectedCard !== state.selectedCard) {
          render();
          return;
        }
        syncVisibleControls();
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

function brandIconSlug(brand?: string) {
  const normalized = String(brand || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!normalized || normalized === 'pending') return '';
  const knownBrands = [
    'volkswagen',
    'volvo',
    'audi',
    'bmw',
    'mercedes',
    'ford',
    'toyota',
    'honda',
    'porsche',
    'renault',
    'peugeot',
    'citroen',
    'fiat',
    'opel',
    'seat',
    'skoda',
    'nissan',
    'mazda',
    'hyundai',
    'kia',
    'mini',
  ];
  const aliases: Record<string, string> = {
    alfaromeo: 'alfaromeo',
    astonmartin: 'astonmartin',
    landrover: 'landrover',
    mercedesbenz: 'mercedes',
    mercedes: 'mercedes',
    vw: 'volkswagen',
    volkswagen: 'volkswagen',
    vag: 'volkswagen',
    rollsroyce: 'rollsroyce',
  };
  for (const [key, value] of Object.entries(aliases)) {
    if (normalized.includes(key)) return value;
  }
  const known = knownBrands.find((name) => normalized.includes(name));
  if (known) return known;
  return aliases[normalized] || normalized;
}

function BrandValue({ brand }: { brand: string }) {
  const slug = brandIconSlug(brand);
  return (
    <span className="brand-value">
      {slug ? <img src={`brands/${slug}.svg`} alt="" aria-hidden="true" onError={(event) => { event.currentTarget.hidden = true; }} /> : null}
      <span>{brand}</span>
    </span>
  );
}

function FileStatusValue({ matched }: { matched: boolean }) {
  if (!matched) return <>Pending</>;
  return (
    <span className="stock-status">
      <span className="stock-status-check">
        <Check size={11} strokeWidth={3} />
      </span>
      <span>Original / stock</span>
    </span>
  );
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

type StageGainInfo = NonNullable<BuildMatch['stage_gains']>[string];

function formatStageGain(gain?: StageGainInfo) {
  if (!gain) return '';
  if (gain.display?.trim()) return gain.display.trim();
  if (Number.isFinite(gain.power_hp) && Number.isFinite(gain.torque_nm)) {
    return `~${gain.power_hp} HP / ~${gain.torque_nm} Nm`;
  }
  if (Number.isFinite(gain.gain_hp) && Number.isFinite(gain.gain_nm)) {
    return `+${gain.gain_hp} HP / +${gain.gain_nm} Nm`;
  }
  return '';
}

function stageGainText(match: BuildMatch | null, stageKey: string) {
  return formatStageGain(match?.stage_gains?.[stageKey]);
}

function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : [];
}

function jobAvailableOptionKeys(job: BuildJob) {
  const payload = (job.revtech_payload || {}) as Record<string, unknown>;
  const offer = (payload.apex_offer || {}) as BuildMatch;
  const selections = buildableSelections(offer);
  if (selections.length) {
    return {
      baseTunes: Array.from(new Set(selections.map((selection) => selection.baseTune).filter(Boolean))),
      addonKeys: Array.from(new Set(selections.flatMap((selection) => selection.addonKeys))),
      selections,
      offer,
    };
  }
  return {
    baseTunes: readStringArray(offer.base_tunes),
    addonKeys: readStringArray(offer.addon_keys),
    selections,
    offer,
  };
}

const APEX_ICON_SRC = 'logos/apex-files-icon-concept-07.png';
const APEX_WORDMARK_SRC = 'logos/apex-files-wordmark-white.png';

function ApexLogo({ compact = false, variant = 'lockup' }: { compact?: boolean; variant?: 'icon' | 'wordmark' | 'lockup' | 'horizontal' }) {
  const logoVariant = compact ? 'icon' : variant;
  if (logoVariant === 'horizontal') {
    return (
      <div className="brand-lockup brand-lockup-horizontal">
        <img className="brand-image brand-image-horizontal-icon" src={APEX_ICON_SRC} alt="" aria-hidden="true" />
        <img className="brand-image brand-image-horizontal-wordmark" src={APEX_WORDMARK_SRC} alt="Apex Files" />
      </div>
    );
  }
  if (logoVariant === 'lockup') {
    return (
      <div className="brand-lockup brand-lockup-lockup brand-lockup-composed">
        <img className="brand-image brand-image-lockup-icon" src={APEX_ICON_SRC} alt="" aria-hidden="true" />
        <img className="brand-image brand-image-lockup-wordmark" src={APEX_WORDMARK_SRC} alt="Apex Files" />
      </div>
    );
  }
  const src = logoVariant === 'icon' ? APEX_ICON_SRC : `logos/apex-files-${logoVariant}-white.png`;
  return (
    <div className={clsx('brand-lockup', compact && 'brand-lockup-compact', `brand-lockup-${logoVariant}`)}>
      <img className={clsx('brand-image', `brand-image-${logoVariant}`)} src={src} alt="Apex Files" />
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

function TopChrome({
  user,
  subscription,
  onNavigate,
  onLogout,
}: {
  user: User | null;
  subscription?: Subscription | null;
  onNavigate?: (page: PageKey) => void;
  onLogout?: () => void;
}) {
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!accountOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (accountRef.current?.contains(event.target as Node)) return;
      setAccountOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    return () => window.removeEventListener('pointerdown', onPointerDown);
  }, [accountOpen]);

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

  const displayName = user.display_name || user.email;
  const planName = displayPackageName(subscription, user);

  function navigate(page: PageKey) {
    onNavigate?.(page);
    setAccountOpen(false);
  }

  return (
    <>
      <div className="app-drag app-header-drag" />
      <header className="app-header app-drag">
        <div className="header-brand">
          <ApexLogo variant="horizontal" />
          <div className="header-divider" />
          <span>Professional ECU Calibration. Unlimited Potential.</span>
        </div>
        <div className="header-actions app-no-drag">
          <div className="header-account-menu" ref={accountRef}>
            <button
              type="button"
              className={clsx('header-plan', 'header-account-trigger', accountOpen && 'open')}
              aria-haspopup="menu"
              aria-expanded={accountOpen}
              onClick={() => setAccountOpen((current) => !current)}
            >
              <Crown size={28} />
              <div>
                <strong>{displayName}</strong>
                <span>{planName}</span>
              </div>
              <i />
              <ChevronDown className="header-account-chevron" size={17} />
            </button>
            {accountOpen ? (
              <div className="account-dropdown" role="menu">
                <button type="button" role="menuitem" onClick={() => navigate('account')}>
                  <UserCircle size={15} />
                  Account
                </button>
                <button type="button" role="menuitem" onClick={() => navigate('my-files')}>
                  <FolderClock size={15} />
                  My Files
                </button>
                <button type="button" role="menuitem" onClick={() => navigate('settings')}>
                  <Settings size={15} />
                  Settings
                </button>
                <button type="button" role="menuitem" onClick={() => navigate('support')}>
                  <Headphones size={15} />
                  Support
                </button>
                <button
                  type="button"
                  role="menuitem"
                  className="account-dropdown-logout"
                  onClick={() => {
                    setAccountOpen(false);
                    onLogout?.();
                  }}
                >
                  <X size={15} />
                  Log out
                </button>
              </div>
            ) : null}
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

function LoginScreen({
  onAuthed,
  designMode,
  designActive,
  designConfig,
  selectedDesignLoginCard,
  onSelectDesignLoginCard,
  onDesignLoginCardChange,
  onDesignHistoryPoint,
}: {
  onAuthed: (user: User) => void;
  designMode: boolean;
  designActive: boolean;
  designConfig: DesignLabConfig;
  selectedDesignLoginCard: DesignLoginKey;
  onSelectDesignLoginCard: (key: DesignLoginKey) => void;
  onDesignLoginCardChange: (key: DesignLoginKey, patch: Partial<DesignCardConfig>, recordHistory?: boolean) => void;
  onDesignHistoryPoint: () => void;
}) {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('admin');
  const [password, setPassword] = useState('admin');
  const [displayName, setDisplayName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [vatNumber, setVatNumber] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [country, setCountry] = useState('');
  const [registerStep, setRegisterStep] = useState(0);
  const [selectedPackage, setSelectedPackage] = useState<PackageKey>('free');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  function changeMode(nextMode: typeof mode) {
    setMode(nextMode);
    setError('');
    if (nextMode === 'login') {
      setEmail('admin');
      setPassword('admin');
      setRegisterStep(0);
      return;
    }
    if (nextMode === 'register') {
      setEmail('');
      setPassword('');
      setDisplayName('');
      setCompanyName('');
      setVatNumber('');
      setPhoneNumber('');
      setCountry('');
      setRegisterStep(0);
      setSelectedPackage('free');
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (mode === 'forgot') {
      setError('Password reset is handled by Apex support for now. Use admin / admin for the temporary admin account.');
      return;
    }
    if (mode === 'register' && registerStep < 2) {
      setRegisterStep((current) => current + 1);
      setError('');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const user =
        mode === 'login'
          ? await login(email, password)
          : await register({
              email,
              password,
              display_name: displayName,
              company_name: companyName,
              vat_number: vatNumber,
              phone_number: phoneNumber,
              country,
              package_key: selectedPackage,
            });
      onAuthed(user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  const registerStepReady =
    registerStep === 0
      ? Boolean(email && password.length >= 8)
      : registerStep === 1
        ? Boolean(displayName.trim() && companyName.trim() && vatNumber.trim() && country.trim())
        : true;
  const submitDisabled = loading || !email || (mode === 'login' && !password) || (mode === 'register' && !registerStepReady);
  const panelTitle = mode === 'login' ? 'Welcome back' : mode === 'register' ? 'Create tuner account' : 'Account recovery';
  const panelEyebrow = mode === 'login' ? 'Customer access' : mode === 'register' ? `Step ${registerStep + 1} of 3` : 'Password help';

  const designVars = designActive
    ? ({
        '--design-font-family': configFontFamily(designConfig.global.fontFamily),
        '--design-font-weight': designConfig.global.fontBold ? 700 : 400,
        '--design-base-font-size': `${designConfig.global.baseFontSize}px`,
        '--design-grid-gap': `${designConfig.global.gridGap}px`,
        '--design-page-bg': designConfig.global.pageBackground,
        '--design-accent': designConfig.global.accentColor,
        '--design-text': designConfig.global.textColor,
        '--design-muted': designConfig.global.mutedColor,
        '--accent': designConfig.global.accentColor,
      } as CSSProperties)
    : undefined;

  function loginDesignCardStyle(key: DesignLoginKey): CSSProperties | undefined {
    if (!designActive) return undefined;
    const card = designConfig.login[key];
    return {
      transform: `translate(${card.x}px, ${card.y}px)`,
      width: card.width ? `${card.width}px` : undefined,
      height: card.height ? `${card.height}px` : undefined,
      minHeight: card.height ? `${card.height}px` : undefined,
      padding: `${card.padding}px`,
      borderRadius: `${card.radius}px`,
      borderWidth: `${card.borderWidth}px`,
      borderColor: card.borderColor,
      background: card.background,
      color: card.textColor,
      fontSize: `${card.fontSize}px`,
      boxShadow: card.shadowOpacity ? `0 24px 74px rgba(0, 0, 0, ${card.shadowOpacity})` : 'none',
      '--design-card-inner-bg': card.innerBackground,
      '--design-card-text': card.textColor,
      '--design-card-muted': card.mutedColor,
      '--design-card-title': card.titleColor,
      '--design-card-font-size': `${card.fontSize}px`,
      '--design-card-title-size': `${card.titleSize}px`,
      '--design-card-label-size': `${card.labelSize}px`,
      '--design-card-gap': `${card.contentGap}px`,
      '--design-card-inner-padding-x': `${card.innerPaddingX}px`,
      '--design-card-inner-padding-y': `${card.innerPaddingY}px`,
      '--design-item-value-offset': `${card.itemValueOffset}px`,
    } as CSSProperties;
  }

  function startLoginDesignDrag(key: DesignLoginKey, event: ReactPointerEvent<HTMLElement>) {
    if (!designMode) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectDesignLoginCard(key);
    onDesignHistoryPoint();
    const startX = event.clientX;
    const startY = event.clientY;
    const startCard = designConfig.login[key];
    const onMove = (moveEvent: PointerEvent) => {
      onDesignLoginCardChange(
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

  function startLoginCardMove(key: DesignLoginKey, event: ReactPointerEvent<HTMLElement>) {
    if (!designMode) return;
    const target = event.target as HTMLElement;
    if (target.closest('.design-card-resize-handle')) return;
    startLoginDesignDrag(key, event);
  }

  function startLoginDesignResize(key: DesignLoginKey, event: ReactPointerEvent<HTMLButtonElement>) {
    if (!designMode) return;
    event.preventDefault();
    event.stopPropagation();
    onSelectDesignLoginCard(key);
    onDesignHistoryPoint();
    const cardElement = event.currentTarget.closest('.login-design-card') as HTMLElement | null;
    const rect = cardElement?.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startCard = designConfig.login[key];
    const startWidth = startCard.width || Math.round(rect?.width || 420);
    const startHeight = startCard.height || Math.round(rect?.height || 240);
    const onMove = (moveEvent: PointerEvent) => {
      onDesignLoginCardChange(
        key,
        {
          width: Math.max(120, Math.round(startWidth + moveEvent.clientX - startX)),
          height: Math.max(0, Math.round(startHeight + moveEvent.clientY - startY)),
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

  function loginDesignClass(key: DesignLoginKey, className: string) {
    return clsx(className, 'login-design-card', designMode && 'design-editable-card', designMode && selectedDesignLoginCard === key && 'design-selected-card');
  }

  function renderLoginDesignHandle(cardKey: DesignLoginKey) {
    if (!designMode) return null;
    return (
      <>
        <button
          type="button"
          className="design-card-handle app-no-drag"
          title={`Drag ${DESIGN_LOGIN_LABELS[cardKey]}`}
          onPointerDown={(event) => startLoginDesignDrag(cardKey, event)}
          onClick={() => onSelectDesignLoginCard(cardKey)}
        >
          <Move size={13} />
          <span>{DESIGN_LOGIN_LABELS[cardKey]}</span>
        </button>
        <button
          type="button"
          className="design-card-resize-handle app-no-drag"
          title={`Resize ${DESIGN_LOGIN_LABELS[cardKey]}`}
          onPointerDown={(event) => startLoginDesignResize(cardKey, event)}
          onClick={() => onSelectDesignLoginCard(cardKey)}
        >
          <Maximize2 size={13} />
        </button>
      </>
    );
  }

  return (
    <main className={clsx('login-screen', designActive && 'design-lab-active')} style={designVars}>
      <div className="login-background" aria-hidden="true" />
      <LoginParticles />
      <section className="login-layout">
        <div
          className={loginDesignClass('hero', 'login-info-panel')}
          style={loginDesignCardStyle('hero')}
          onPointerDown={(event) => startLoginCardMove('hero', event)}
          onClick={() => designMode && onSelectDesignLoginCard('hero')}
        >
          {renderLoginDesignHandle('hero')}
          <ApexLogo variant="lockup" />
          <div className="login-hero-copy">
            <span>Powered by Revtech</span>
            <h1>Professional ECU file service for tuners.</h1>
            <p>Match original files, choose available versions and deliver prepared files from one focused desktop workspace.</p>
          </div>
          <div className="login-feature-list">
            <div>
              <Search size={17} />
              <span><strong>Fast matching</strong> from original ECU files</span>
            </div>
            <div>
              <FileCog size={17} />
              <span><strong>Stage files and add-ons</strong> prepared from available matches</span>
            </div>
            <div>
              <FolderClock size={17} />
              <span><strong>Saved projects</strong> for completed files and customer details</span>
            </div>
          </div>
          <p className="login-plan-note">Apex Lite starts at 20 files per month. Apex Pro unlocks unlimited file delivery.</p>
        </div>
        <form
          className={loginDesignClass('auth', 'login-auth-panel')}
          style={loginDesignCardStyle('auth')}
          onPointerDown={(event) => startLoginCardMove('auth', event)}
          onClick={() => designMode && onSelectDesignLoginCard('auth')}
          onSubmit={onSubmit}
        >
          {renderLoginDesignHandle('auth')}
          <div className="login-panel-top">
            {mode === 'forgot' ? <Headphones size={20} /> : mode === 'register' ? <UserPlus size={20} /> : <LockKeyhole size={20} />}
            <div>
              <span>{panelEyebrow}</span>
              <h2>{panelTitle}</h2>
            </div>
          </div>
          {mode === 'register' ? (
            <div className="register-progress" aria-label="Registration progress">
              {[0, 1, 2].map((step) => (
                <span key={step} className={clsx(step <= registerStep && 'active')} />
              ))}
            </div>
          ) : null}

          <div className="login-card">
            {mode === 'register' && registerStep === 2 ? (
              <div className="register-package-choice">
                {PACKAGE_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    className={clsx(selectedPackage === option.key && 'selected')}
                    onClick={() => setSelectedPackage(option.key)}
                  >
                    <span>{option.name}</span>
                    <strong>{option.price ? `$${option.price} / month` : '$0 / month'}</strong>
                  </button>
                ))}
              </div>
            ) : null}

            {mode !== 'register' || registerStep === 0 ? (
              <label>
                <span>{mode === 'register' ? 'Email' : 'Account'}</span>
                <input value={email} onChange={(event) => setEmail(event.target.value)} type="text" autoComplete="username" placeholder={mode === 'register' ? 'name@company.com' : 'admin'} />
              </label>
            ) : null}

            {mode === 'register' && registerStep === 1 ? (
              <div className="register-details-grid">
                <label>
                  <span>Full name</span>
                  <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
                </label>
                <label>
                  <span>Company</span>
                  <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
                </label>
                <label>
                  <span>VAT number</span>
                  <input value={vatNumber} onChange={(event) => setVatNumber(event.target.value)} placeholder="SE1234567890" />
                </label>
                <label>
                  <span>Country</span>
                  <input value={country} onChange={(event) => setCountry(event.target.value)} placeholder="Sweden" />
                </label>
                <label className="register-wide-field">
                  <span>Phone</span>
                  <input value={phoneNumber} onChange={(event) => setPhoneNumber(event.target.value)} placeholder="+46" />
                </label>
              </div>
            ) : null}

            {mode === 'register' && registerStep === 2 ? (
              <div className="register-review">
                <span>{email}</span>
                <strong>{displayName || 'New tuner'} - {companyName || 'Company'}</strong>
                <small>{vatNumber || 'VAT pending'} / {country || 'Country pending'}</small>
              </div>
            ) : null}

            {mode === 'login' || (mode === 'register' && registerStep === 0) ? (
              <label>
                <span>Password</span>
                <input
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  type="password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  placeholder={mode === 'login' ? 'admin' : 'Minimum 8 characters'}
                />
              </label>
            ) : null}

            {mode === 'forgot' ? (
              <div className="forgot-note">
                <Info size={16} />
                <span>Enter your account and contact Apex support for a reset. Temporary admin access is admin / admin.</span>
              </div>
            ) : null}
          </div>

          {error ? <div className="form-error">{error}</div> : null}

          <button className="primary-action" disabled={submitDisabled}>
            {loading ? <Loader2 className="spin" size={16} /> : mode === 'login' ? <LogIn size={16} /> : mode === 'register' ? <UserPlus size={16} /> : <Headphones size={16} />}
            {mode === 'login' ? 'Log in' : mode === 'register' && registerStep < 2 ? 'Continue' : mode === 'register' ? 'Create account' : 'Show reset instructions'}
          </button>
          <div className="login-hint-row">
            {mode === 'register' && registerStep > 0 ? (
              <button type="button" className="text-action" onClick={() => setRegisterStep((current) => Math.max(0, current - 1))}>
                Back
              </button>
            ) : (
              <button type="button" className="text-action" onClick={() => changeMode(mode === 'login' ? 'register' : 'login')}>
                {mode === 'login' ? 'Create an account' : 'Back to login'}
              </button>
            )}
            {mode === 'login' ? (
              <button type="button" className="text-action" onClick={() => changeMode('forgot')}>
                Forgot password?
              </button>
            ) : null}
            {mode === 'register' ? (
              <button type="button" className="text-action" onClick={() => changeMode('login')}>
                Login instead
              </button>
            ) : null}
            {mode === 'forgot' ? (
              <button type="button" className="text-action" onClick={() => changeMode('login')}>
                Back to login
              </button>
            ) : null}
          </div>
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
  const items: { key: string; page: PageKey; label: string; icon: ReactNode }[] = [
    { key: 'dashboard', page: 'dashboard', label: 'Dashboard', icon: <Home size={20} /> },
    { key: 'file-service', page: 'file-service', label: 'File Service', icon: <FileCog size={20} /> },
    { key: 'my-files', page: 'my-files', label: 'My Files', icon: <FolderClock size={20} /> },
    { key: 'downloads', page: 'downloads', label: 'Downloads', icon: <Download size={20} /> },
    { key: 'packages', page: 'packages', label: 'Packages', icon: <Gauge size={20} /> },
    { key: 'support', page: 'support', label: 'Support', icon: <Headphones size={20} /> },
    { key: 'settings', page: 'settings', label: 'Settings', icon: <Settings size={20} /> },
  ];
  const planName = displayPackageName(subscription);
  const renewDate = subscription ? new Date(subscription.period_ends_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Loading';

  return (
    <aside className="sidebar">
      <div className="sidebar-inner">
        <nav>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={clsx(item.page === active && 'active')}
              onClick={() => onChange(item.page)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-account-summary">
            <span>Package</span>
            <strong>{planName}</strong>
            <small>Renews {renewDate}</small>
          </div>
          <div className="sidebar-version">
            <span>v{APP_VERSION}</span>
            <i />
            <span>Up to date</span>
          </div>
        </div>
      </div>
    </aside>
  );
}

function StatusBadge({ status }: { status: string }) {
  const ready = ['ready', 'active', 'online'].includes(status);
  const failed = status === 'failed';
  const label = status === 'active' ? 'Active' : status === 'online' ? 'Online' : status === 'ready' ? 'Ready' : failed ? 'Needs attention' : status.replace(/_/g, ' ');
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

function MatchInfoRow({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
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

function FileMatchDetailsModal({
  match,
  file,
  onClose,
}: {
  match: BuildMatch;
  file: File | null;
  onClose: () => void;
}) {
  const metadata = match.metadata || {};
  const vehicle = firstDisplayValue(metadata.vehicle, match.vehicle_label);
  const brand = firstDisplayValue(metadata.brand, vehicleBrand(vehicle));
  const model = firstDisplayValue(metadata.model, vehicleModel(vehicle));
  const engine = firstDisplayValue(metadata.engine, metadata.engine_code, engineLabel(vehicle));
  const ecuType = firstDisplayValue(metadata.ecu_type, match.ecu_label);
  const software = firstDisplayValue(metadata.software_number, metadata.calibration_id, softwareNumber(file?.name || match.source_filename));
  const hardware = firstDisplayValue(metadata.hardware_number, 'Matched');
  const availableVersions = match.base_tunes.map((key) => BASE_OPTION_LABELS[key] || key).join(', ') || 'No versions listed';
  const availableOptions = match.addon_keys.map((key) => ADDON_OPTION_LABELS[key] || key).join(', ') || 'No additional options';
  const sourceFile = file?.name || match.source_filename || 'Original ECU file';
  const visibleRows = (rows: Array<[string, ReactNode]>) =>
    rows.filter(([, value]) => Boolean(value) && (typeof value !== 'string' || value !== 'Pending'));
  const vehicleRows = visibleRows([
    ['Vehicle', vehicle],
    ['Brand', <BrandValue brand={brand} />],
    ['Model', model],
    ['Generation', firstDisplayValue(metadata.generation)],
    ['Engine', engine],
  ]);
  const ecuRows = visibleRows([
    ['ECU type', ecuType],
    ['ECU producer', firstDisplayValue(metadata.ecu_producer)],
    ['ECU build', firstDisplayValue(metadata.ecu_build)],
    ['Software number', software],
    ['Hardware number', hardware],
    ['File status', <FileStatusValue matched />],
  ]);
  const deliveryRows: Array<[string, ReactNode]> = [
    ['Original file', sourceFile],
    ['File size', formatFileSize(match.source_size_bytes || file?.size || 0)],
    ['Available versions', availableVersions],
    ['Available options', availableOptions],
  ];

  function renderDetailsSection(title: string, rows: Array<[string, ReactNode]>) {
    return (
      <section className="match-details-section">
        <h3>{title}</h3>
        <div className="match-details-list">
          {rows.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <ModalShell title="Scan details" eyebrow="Scan complete" icon={<FileCog size={18} />} onClose={onClose}>
      <div className="match-details-shell">
        <div className="match-details-hero">
          <div className="match-details-brandmark">
            <BrandValue brand={brand} />
          </div>
          <div className="match-details-hero-copy">
            <span>File information</span>
            <h3>{vehicle}</h3>
            <p>{engine} / {ecuType}</p>
          </div>
          <div className="match-details-hero-status">
            <FileStatusValue matched />
          </div>
        </div>
        <div className="match-details-sections">
          {renderDetailsSection('Vehicle', vehicleRows)}
          {renderDetailsSection('ECU', ecuRows)}
          {renderDetailsSection('Delivery', deliveryRows)}
        </div>
      </div>
    </ModalShell>
  );
}

function BuildDeliveryModal({
  job,
  onClose,
  onDownloaded,
  onSaved,
  onRetried,
}: {
  job: BuildJob;
  onClose: () => void;
  onDownloaded: (jobId: string) => void;
  onSaved: () => void;
  onRetried: (job: BuildJob) => void;
}) {
  const ready = job.status === 'ready';
  const failed = job.status === 'failed';
  const requestedAddonKeys = readStringArray(job.requested_options?.addon_keys);
  const addonLabels = requestedAddonKeys.map((key) => ADDON_OPTION_LABELS[key] || key).filter(Boolean);
  const available = jobAvailableOptionKeys(job);
  const requestedSignature = selectionSignature(job.base_tune, requestedAddonKeys);
  const preferredRetrySelection = available.selections.find((selection) => selection.signature === requestedSignature)
    || available.selections.find((selection) => selection.baseTune === job.base_tune)
    || available.selections[0];
  const [projectName, setProjectName] = useState(job.vehicle_label || job.result_filename || job.source_filename);
  const [vehicleLabel, setVehicleLabel] = useState(job.vehicle_label);
  const [ecuLabel, setEcuLabel] = useState(job.ecu_label);
  const [comments, setComments] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [retryBaseTune, setRetryBaseTune] = useState(() => (
    preferredRetrySelection?.baseTune
    ?? (available.baseTunes.includes(job.base_tune) ? job.base_tune : available.baseTunes[0] || '')
  ));
  const [retryAddonKeys, setRetryAddonKeys] = useState<string[]>(() => (
    preferredRetrySelection?.addonKeys
    ?? requestedAddonKeys.filter((key) => available.addonKeys.includes(key))
  ));
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [requestSaved, setRequestSaved] = useState(false);
  const [requestError, setRequestError] = useState('');
  const selectedRetryBaseTune = retryBaseTune && available.baseTunes.includes(retryBaseTune)
    ? retryBaseTune
    : '';
  const selectedRetryAddonKeys = retryAddonKeys.filter((key) => available.addonKeys.includes(key));
  const hasAvailableAlternatives = available.baseTunes.length > 0 || available.addonKeys.length > 0;
  const hasAvailableSelection = Boolean(selectedRetryBaseTune) || selectedRetryAddonKeys.length > 0;
  const retrySelectionBuildable = isBuildableSelection(available.offer, selectedRetryBaseTune, selectedRetryAddonKeys);
  const canRetryAvailable = failed && hasAvailableAlternatives && hasAvailableSelection && retrySelectionBuildable;
  const requestedOptionText = addonLabels.length ? addonLabels.join(', ') : 'No additional options';
  const preparing = !ready && !failed;
  const preparingProgress = Math.max(0, Math.min(100, Math.round(job.progress || 0)));
  const preparingStage = displayScanStage(job.current_stage) || 'Preparing delivery';

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

  function toggleRetryAddon(key: string) {
    setRetryAddonKeys((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  async function retryAvailableBuild() {
    if (!failed || !hasAvailableSelection) return;
    setRetrying(true);
    setRetryError('');
    try {
      const nextJob = await retryBuild({
        job_id: job.id,
        base_tune: selectedRetryBaseTune,
        addon_keys: selectedRetryAddonKeys,
      });
      onRetried(nextJob);
    } catch (error) {
      setRetryError(userFacingError(error, 'Could not start this available file. Please try again.'));
    } finally {
      setRetrying(false);
    }
  }

  async function requestSelectedFile() {
    if (!failed) return;
    setRequesting(true);
    setRequestError('');
    try {
      await requestBuildFile({
        job_id: job.id,
        base_tune: job.base_tune,
        addon_keys: requestedAddonKeys,
        comments,
      });
      setRequestSaved(true);
      onSaved();
    } catch (error) {
      setRequestError(userFacingError(error, 'Could not request this file. Please try again.'));
    } finally {
      setRequesting(false);
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
      {!ready ? (
        <div className="finished-summary">
          <div>
            <span>Requested version</span>
            <strong>{baseTuneLabel(job.base_tune)}</strong>
          </div>
          <div>
            <span>Requested options</span>
            <strong>{requestedOptionText}</strong>
          </div>
        </div>
      ) : null}
      {job.error_message ? <div className="form-error">{job.error_message}</div> : null}
      {failed ? (
        <div className="delivery-decision-shell">
          <section className="delivery-path-card available-path">
            <div className="delivery-path-heading">
              <Search size={18} />
              <div>
                <span>Available now</span>
                <h3>Build from matched options</h3>
                <p>Pick a version and any ready add-ons below. This starts a new delivery using files already found by the scan.</p>
              </div>
            </div>
            {hasAvailableAlternatives ? (
              <>
                <div className="delivery-selection-block">
                  <span className="delivery-group-label">Stage / version</span>
                  {available.baseTunes.length ? (
                    <div className="delivery-option-grid">
                      {available.baseTunes.map((key) => (
                        <button
                          key={key}
                          type="button"
                          className={clsx('delivery-stage-option', selectedRetryBaseTune === key && 'selected')}
                          onClick={() => setRetryBaseTune((current) => (current === key ? '' : key))}
                        >
                          <span className="stage-radio" />
                          <div>
                            <strong>{BASE_OPTION_LABELS[key] || key}</strong>
                            <small>Ready to build</small>
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="delivery-empty-option">No stage file is available for instant build.</div>
                  )}
                </div>
                <div className="delivery-selection-block">
                  <span className="delivery-group-label">Additional options</span>
                  {available.addonKeys.length ? (
                    <div className="delivery-option-grid">
                      {available.addonKeys.map((key) => {
                        const option = ADDON_OPTIONS.find((item) => item.key === key);
                        const selected = selectedRetryAddonKeys.includes(key);
                        return (
                          <button
                            key={key}
                            type="button"
                            className={clsx('delivery-addon-tile addon-tile', selected && 'selected')}
                            onClick={() => toggleRetryAddon(key)}
                          >
                            <span className="addon-icon">{option?.icon || <Wrench size={14} />}</span>
                            <span className="addon-copy">
                              <strong>{option?.label || ADDON_OPTION_LABELS[key] || key}</strong>
                              <small>{option?.group || 'Ready to combine'}</small>
                            </span>
                            <span className="addon-state">{selected ? <Check size={13} strokeWidth={3} /> : null}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="delivery-empty-option">No add-ons are available for instant build.</div>
                  )}
                </div>
                {hasAvailableSelection && !retrySelectionBuildable ? (
                  <div className="delivery-empty-option strong-empty">
                    This exact combination is not prepared. Choose a FOUND combination or request the file.
                  </div>
                ) : null}
                {retryError ? <div className="form-error">{retryError}</div> : null}
                <button className="primary-action delivery-path-action" type="button" disabled={!canRetryAvailable || retrying} onClick={() => void retryAvailableBuild()}>
                  {retrying ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
                  Build selected available file
                </button>
              </>
            ) : (
              <div className="delivery-empty-option strong-empty">No instant delivery options were found for this exact file.</div>
            )}
          </section>
          <section className="delivery-path-card request-path">
            <div className="delivery-path-heading">
              <FolderPlus size={18} />
              <div>
                <span>Request exact file</span>
                <h3>Ask Apex to make this combination</h3>
                <p>Use this when you want the selected version and options exactly as requested.</p>
              </div>
            </div>
            <div className="delivery-request-summary">
              <div>
                <span>Version</span>
                <strong>{baseTuneLabel(job.base_tune)}</strong>
              </div>
              <div>
                <span>Options</span>
                <strong>{requestedOptionText}</strong>
              </div>
            </div>
            <label className="request-comment-field">
              <span>Request comment</span>
              <textarea value={comments} rows={4} placeholder="Add customer notes, hardware changes, deadline or anything the file team should know." onChange={(event) => setComments(event.target.value)} />
            </label>
            {requestSaved ? (
              <div className="success-panel compact-success">
                <CheckCircle2 size={16} />
                <span>Request saved to My Files.</span>
              </div>
            ) : null}
            {requestError ? <div className="form-error">{requestError}</div> : null}
            <button className="primary-action delivery-path-action" type="button" disabled={requesting || requestSaved} onClick={() => void requestSelectedFile()}>
              {requesting ? <Loader2 className="spin" size={16} /> : <FolderPlus size={16} />}
              {requestSaved ? 'Request saved' : 'Request this exact file'}
            </button>
          </section>
        </div>
      ) : null}
      {ready ? (
        <div className="delivery-decision-shell delivery-ready-shell">
          <section className="delivery-path-card available-path">
            <div className="delivery-path-heading">
              <Download size={18} />
              <div>
                <span>Ready now</span>
                <h3>Download prepared file</h3>
                <p>The selected version and options have been prepared and are ready for delivery.</p>
              </div>
            </div>
            <div className="delivery-request-summary">
              <div>
                <span>Completed file</span>
                <strong>{job.result_filename || 'Ready file'}</strong>
              </div>
              <div>
                <span>Version</span>
                <strong>{baseTuneLabel(job.base_tune)}</strong>
              </div>
              <div>
                <span>Options</span>
                <strong>{requestedOptionText}</strong>
              </div>
            </div>
            {downloadError ? <div className="form-error">{downloadError}</div> : null}
            <button className="primary-action delivery-path-action" type="button" disabled={downloading} onClick={() => void downloadReadyFile()}>
              {downloading ? <Loader2 className="spin" size={16} /> : <Download size={16} />}
              Download file
            </button>
          </section>
          <section className="delivery-path-card request-path">
            <div className="delivery-path-heading">
              <FolderPlus size={18} />
              <div>
                <span>Save project</span>
                <h3>Save to My Files</h3>
                <p>Add customer/project details so this delivery is easy to find later.</p>
              </div>
            </div>
            <div className="delivery-save-form">
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
            </div>
            {saved ? (
              <div className="success-panel compact-success">
                <CheckCircle2 size={16} />
                <span>Saved to My Files.</span>
              </div>
            ) : null}
            {saveError ? <div className="form-error">{saveError}</div> : null}
            <button className="primary-action delivery-path-action" type="button" disabled={saving || !projectName.trim()} onClick={() => void saveToFiles()}>
              {saving ? <Loader2 className="spin" size={16} /> : <FolderPlus size={16} />}
              Save to My Files
            </button>
          </section>
        </div>
      ) : null}
      {preparing ? (
        <div className="delivery-preparing-shell">
          <div className="delivery-path-heading">
            <Loader2 className="spin" size={18} />
            <div>
              <span>Preparing delivery</span>
              <h3>Building your selected file</h3>
              <p>Apex is preparing the requested version and options. This modal will update when the file is ready.</p>
            </div>
          </div>
          <div className="delivery-preparing-progress">
            <div>
              <span>{preparingStage}</span>
              <strong>{preparingProgress}%</strong>
            </div>
            <div className="delivery-preparing-track">
              <span style={{ width: `${preparingProgress}%` }} />
            </div>
          </div>
          <div className="delivery-request-summary">
            <div>
              <span>Version</span>
              <strong>{baseTuneLabel(job.base_tune)}</strong>
            </div>
            <div>
              <span>Options</span>
              <strong>{requestedOptionText}</strong>
            </div>
          </div>
        </div>
      ) : null}
      <div className={clsx('modal-actions delivery-modal-actions', (failed || ready || preparing) && 'delivery-modal-actions-failed')}>
        <button className="quiet-action" type="button" onClick={onClose}>
          Close
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
  onFileChanged,
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
  onFileChanged: () => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const matchRequestId = useRef(0);
  const dropDepth = useRef(0);
  const [file, setFile] = useState<File | null>(null);
  const [scanJob, setScanJob] = useState<BuildScan | null>(null);
  const [matchResult, setMatchResult] = useState<BuildMatch | null>(null);
  const [baseTune, setBaseTune] = useState('');
  const [addons, setAddons] = useState<string[]>([]);
  const [addonPage, setAddonPage] = useState(0);
  const [dropActive, setDropActive] = useState(false);
  const [vehicle, setVehicle] = useState('');
  const [ecu, setEcu] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [matchLoading, setMatchLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function selectFile(nextFile: File | null) {
    matchRequestId.current += 1;
    dropDepth.current = 0;
    setDropActive(false);
    setFile(nextFile);
    setScanJob(null);
    setMatchResult(null);
    setDetailsOpen(false);
    setBaseTune('');
    setAddons([]);
    setAddonPage(0);
    setVehicle('');
    setEcu('');
    setMatchLoading(false);
    setLoading(false);
    setError('');
    onFileChanged();
  }

  function dragEventHasFiles(event: DragEvent<HTMLElement>) {
    return Array.from(event.dataTransfer.types || []).includes('Files');
  }

  function handleFileDragEnter(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    if (!dragEventHasFiles(event)) return;
    dropDepth.current += 1;
    setDropActive(true);
  }

  function handleFileDragOver(event: DragEvent<HTMLElement>) {
    if (!dragEventHasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    setDropActive(true);
  }

  function handleFileDragLeave(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dropDepth.current = Math.max(0, dropDepth.current - 1);
    if (dropDepth.current === 0) setDropActive(false);
  }

  function handleFileDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    dropDepth.current = 0;
    setDropActive(false);
    selectFile(event.dataTransfer.files?.[0] || null);
  }

  useEffect(() => {
    const hasFiles = (event: globalThis.DragEvent) => Array.from(event.dataTransfer?.types || []).includes('Files');
    const handleWindowDragOver = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    };
    const handleWindowDrop = (event: globalThis.DragEvent) => {
      if (!hasFiles(event)) return;
      const target = event.target as Element | null;
      if (target?.closest('.ecu-drop-target')) return;
      event.preventDefault();
      dropDepth.current = 0;
      setDropActive(false);
    };
    window.addEventListener('dragenter', handleWindowDragOver);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('drop', handleWindowDrop);
    return () => {
      window.removeEventListener('dragenter', handleWindowDragOver);
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, []);

  function toggleAddon(key: string) {
    if (!matchResult) return;
    setAddons((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  async function findMatch() {
    if (!file) return;
    const requestId = matchRequestId.current + 1;
    const fileForRequest = file;
    matchRequestId.current = requestId;
    setError('');
    setScanJob(null);
    setMatchResult(null);
    setBaseTune('');
    setAddons([]);
    setAddonPage(0);
    setMatchLoading(true);
    try {
      let scan = await startBuildScan(fileForRequest);
      if (matchRequestId.current !== requestId) return;
      setScanJob(scan);
      while (['queued', 'scanning'].includes(String(scan.status || '').toLowerCase())) {
        await new Promise((resolve) => window.setTimeout(resolve, Math.max(900, Number(scan.progress || 0) < 35 ? 1300 : 1800)));
        if (matchRequestId.current !== requestId) return;
        scan = await getBuildScan(scan.id);
        if (matchRequestId.current !== requestId) return;
        setScanJob(scan);
      }
      if (String(scan.status || '').toLowerCase() === 'failed') {
        throw new Error(scan.error_message || 'Could not scan this file.');
      }
      const result = scan.result_payload;
      if (!result) throw new Error('The scan did not return delivery candidates.');
      setMatchResult(result);
      if (!vehicle.trim() && result.vehicle_label) setVehicle(result.vehicle_label);
      if (!ecu.trim() && result.ecu_label) setEcu(result.ecu_label);
    } catch (reason) {
      if (matchRequestId.current !== requestId) return;
      setError(userFacingError(reason, 'Could not scan this file. Please try again.'));
    } finally {
      if (matchRequestId.current === requestId) setMatchLoading(false);
    }
  }

  async function submit() {
    if (!file || !matchResult || (!baseTune && addons.length === 0)) return;
    setError('');
    setLoading(true);
    try {
      const job = await createBuild({
        file,
        base_tune: baseTune,
        addon_keys: addons,
        vehicle_label: vehicle,
        ecu_label: ecu,
        scan_id: scanJob?.id,
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

  const selectionStatus = (selectionBase: string, selectionAddons: string[]): SelectionStatus => (
    isBuildableSelection(matchResult, selectionBase, selectionAddons)
      ? 'found'
      : isCandidateSelection(matchResult, selectionBase, selectionAddons)
        ? 'candidate'
        : 'request'
  );
  const baseOptionStatus = (key: string) => selectionStatus(key, addons);
  const addonOptionStatus = (key: string) => selectionStatus(
    baseTune,
    addons.includes(key) ? addons : [...addons, key],
  );
  const hasSelectedOptions = Boolean(baseTune) || addons.length > 0;
  const selectedCombinationFound = hasSelectedOptions && isBuildableSelection(matchResult, baseTune, addons);
  const selectedCombinationCandidate = hasSelectedOptions && isCandidateSelection(matchResult, baseTune, addons);
  const selectedUnavailableCount = hasSelectedOptions && !selectedCombinationFound && !selectedCombinationCandidate ? 1 : 0;
  const hasRequestSelection = selectedUnavailableCount > 0;
  const submitActionLabel = hasRequestSelection ? 'Request file' : selectedCombinationCandidate ? 'Validate & build' : 'Build file';
  const submitActionIcon = hasRequestSelection ? <FolderPlus size={17} /> : <FileCog size={17} />;
  const scanned = Boolean(matchResult);
  const sortedAddonOptions = ADDON_OPTIONS
    .map((option, index) => ({ option, index, status: addonOptionStatus(option.key) }))
    .sort((left, right) => {
      const priority: Record<SelectionStatus, number> = { found: 2, candidate: 1, request: 0 };
      return priority[right.status] - priority[left.status] || left.index - right.index;
    })
    .map((entry) => entry.option);
  const foundAddonCount = sortedAddonOptions.filter((option) => addonOptionStatus(option.key) === 'found').length;
  const addonPageSize = Math.max(12, Math.min(ADDON_OPTIONS.length, foundAddonCount || 0));
  const addonPageCount = Math.max(1, Math.ceil(sortedAddonOptions.length / addonPageSize));
  const activeAddonPage = Math.min(addonPage, addonPageCount - 1);
  const visibleAddonOptions = sortedAddonOptions.slice(activeAddonPage * addonPageSize, activeAddonPage * addonPageSize + addonPageSize);
  const canBuild = Boolean(file && scanned && (baseTune || addons.length) && !loading && !matchLoading);
  const canOpenDelivery = Boolean(currentJob && deliveryReady && file && currentJob.source_filename === file.name);
  const matched = scanned;
  const selectedBaseLabel = baseTuneLabel(baseTune, scanned ? 'No stage selected' : 'Pending scan');
  const selectedBaseGainText = stageGainText(matchResult, baseTune);
  const selectedAddonLabels = addons.map((key) => ADDON_OPTION_LABELS[key] || key);
  const matchMetadata = matchResult?.metadata || {};
  const vehicleDisplay = firstDisplayValue(matchMetadata.vehicle, matchResult?.vehicle_label, vehicle);
  const brandDisplay = firstDisplayValue(matchMetadata.brand, vehicleBrand(vehicleDisplay));
  const modelDisplay = firstDisplayValue(matchMetadata.model, vehicleModel(vehicleDisplay));
  const engineDisplay = firstDisplayValue(matchMetadata.engine, matchMetadata.engine_code, engineLabel(vehicleDisplay));
  const ecuDisplay = firstDisplayValue(matchMetadata.ecu_type, matchResult?.ecu_label, ecu);
  const softwareDisplay = scanned ? firstDisplayValue(matchMetadata.software_number, matchMetadata.calibration_id, softwareNumber(file?.name || matchResult?.source_filename)) : 'Pending';
  const hardwareDisplay = scanned ? firstDisplayValue(matchMetadata.hardware_number, 'Matched') : 'Pending';
  const matchStatusText = matchLoading
    ? displayScanStage(scanJob?.current_stage) || 'Scanning file'
    : scanned
      ? 'Found delivery options'
      : file
        ? 'Ready to scan'
        : 'Choose a file to start';
  const designVars = designActive
    ? ({
        '--design-font-family': configFontFamily(designConfig.global.fontFamily),
        '--design-font-weight': designConfig.global.fontBold ? 700 : 400,
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
        '--design-window-min-width': `${designConfig.global.windowMinWidth}px`,
        '--design-window-min-height': `${designConfig.global.windowMinHeight}px`,
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
      '--design-card-font-size': `${card.fontSize}px`,
      '--design-card-title-size': `${card.titleSize}px`,
      '--design-card-label-size': `${card.labelSize}px`,
      '--design-card-gap': `${card.contentGap}px`,
      '--design-card-inner-padding-x': `${card.innerPaddingX}px`,
      '--design-card-inner-padding-y': `${card.innerPaddingY}px`,
      '--design-item-padding-x': `${card.itemPaddingX}px`,
      '--design-item-padding-y': `${card.itemPaddingY}px`,
      '--design-item-gap': `${card.itemGap}px`,
      '--design-item-min-height': `${card.itemMinHeight}px`,
      '--design-item-label-size': `${card.itemLabelSize}px`,
      '--design-item-value-size': `${card.itemValueSize}px`,
      '--design-item-icon-size': `${card.itemIconSize}px`,
      '--design-item-value-offset': `${card.itemValueOffset}px`,
      '--design-stage-bg': card.stageBackground,
      '--design-stage-border': card.stageBorderColor,
      '--design-stage-selected-bg': card.stageSelectedBackground,
      '--design-stage-selected-border': card.stageSelectedBorderColor,
      '--design-option-bg': card.optionBackground,
      '--design-option-border': card.optionBorderColor,
      '--design-option-selected-bg': card.optionSelectedBackground,
      '--design-option-selected-border': card.optionSelectedBorderColor,
    } as CSSProperties;
  }

  function designInnerStyle(key: DesignCardKey): CSSProperties | undefined {
    if (!designActive) return undefined;
    return {
      background: designConfig.cards[key].innerBackground,
    };
  }

  function startDesignDrag(key: DesignCardKey, event: ReactPointerEvent<HTMLElement>) {
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

  function startDesignCardMove(key: DesignCardKey, event: ReactPointerEvent<HTMLElement>) {
    if (!designMode) return;
    const target = event.target as HTMLElement;
    if (target.closest('.design-card-resize-handle')) return;
    startDesignDrag(key, event);
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
      {detailsOpen && matchResult ? (
        <FileMatchDetailsModal match={matchResult} file={file} onClose={() => setDetailsOpen(false)} />
      ) : null}
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
          <section className={designCardClass('upload', 'service-card upload-service-card')} style={designCardStyle('upload')} onPointerDown={(event) => startDesignCardMove('upload', event)} onClick={() => designMode && onSelectDesignCard('upload')}>
            {renderDesignHandle('upload')}
            <StepTitle index={1} title="Upload original ECU file" />
            <input
              ref={fileInput}
              type="file"
              className="hidden-input"
              onChange={(event) => selectFile(event.target.files?.[0] || null)}
            />
            <div
              className={clsx('ecu-drop-target', file && 'has-file', dropActive && 'drop-active')}
              style={designInnerStyle('upload')}
              onDragEnter={handleFileDragEnter}
              onDragOver={handleFileDragOver}
              onDragLeave={handleFileDragLeave}
              onDrop={handleFileDrop}
            >
              <span className="drop-cloud">
                <CloudUpload size={54} strokeWidth={1.7} />
              </span>
              <strong>{dropActive ? 'Drop here' : 'Drag & drop your ECU file here'}</strong>
              <span>{dropActive ? 'Release to upload this ECU file' : 'or'}</span>
              <button className="drop-browse-button" type="button" onClick={() => fileInput.current?.click()}>
                Browse Files
              </button>
              <small>Supported formats: .bin .hex .ori .dat .ecu</small>
            </div>
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

          <section className={designCardClass('match', 'service-card match-service-card')} style={designCardStyle('match')} onPointerDown={(event) => startDesignCardMove('match', event)} onClick={() => designMode && onSelectDesignCard('match')}>
            {renderDesignHandle('match')}
            <StepTitle index={2} title="Scan file" />
            <div className="match-center-panel" style={designInnerStyle('match')}>
              <div className={clsx('match-search-visual', matchLoading && 'scanning', scanned && 'confirmed')} aria-hidden="true">
                <span className="match-search-ring match-search-ring-one" />
                <span className="match-search-ring match-search-ring-two" />
                <span className="match-search-core">
                  {scanned ? <Check size={33} strokeWidth={2.6} /> : <Search size={40} strokeWidth={1.9} />}
                </span>
              </div>
              <p className="match-instruction">Scan the backend for available versions, add-ons and supported delivery methods.</p>
              <button className="match-action match-action-large" disabled={!file || matchLoading || loading} type="button" onClick={() => void findMatch()}>
                {matchLoading ? <Loader2 className="spin" size={16} /> : <Search size={16} />}
                Scan file
                <ChevronRight size={17} />
              </button>
              {(matchLoading || scanJob) ? (
                <div className="scan-progress-panel">
                  <div className="scan-progress-bar">
                    <span style={{ width: `${Math.max(3, Math.min(100, scanJob?.progress || (matchLoading ? 8 : 0)))}%` }} />
                  </div>
                </div>
              ) : null}
              <div className={clsx('match-feedback', scanned && 'confirmed')}>
                {scanned ? <CheckCircle2 size={15} /> : <Info size={15} />}
                <div>
                  <span>{matchStatusText}</span>
                </div>
              </div>
            </div>
          </section>

          <section className={designCardClass('results', 'service-card results-service-card')} style={designCardStyle('results')} onPointerDown={(event) => startDesignCardMove('results', event)} onClick={() => designMode && onSelectDesignCard('results')}>
            {renderDesignHandle('results')}
            <div className="card-title-row">
              <StepTitle index={3} title="Scan results" />
              <span className={clsx('result-chip', scanned && 'confirmed')}>
                {scanned ? 'Found' : 'Waiting'}
              </span>
            </div>
            <div className="match-results-box" style={designInnerStyle('results')}>
              <div className="match-info-list">
                <MatchInfoRow icon={<Car size={15} />} label="Vehicle" value={vehicleDisplay} />
                <MatchInfoRow icon={<Car size={15} />} label="Brand" value={scanned ? <BrandValue brand={brandDisplay} /> : brandDisplay} />
                <MatchInfoRow icon={<Car size={15} />} label="Model" value={modelDisplay} />
                <MatchInfoRow icon={<Gauge size={15} />} label="Engine" value={engineDisplay} />
                <MatchInfoRow icon={<Cpu size={15} />} label="ECU Type" value={ecuDisplay} />
                <MatchInfoRow icon={<FileText size={15} />} label="Software Number" value={softwareDisplay} />
                <MatchInfoRow icon={<Cpu size={15} />} label="Hardware Number" value={hardwareDisplay} />
                <MatchInfoRow icon={<FileText size={15} />} label="File status" value={<FileStatusValue matched={scanned} />} />
              </div>
              {scanned ? (
                <button className="details-action secondary-action compact" type="button" onClick={() => setDetailsOpen(true)}>
                  View details
                  <Eye size={14} />
                </button>
              ) : null}
            </div>
          </section>

          <section
            className={clsx(designCardClass('tuning', 'service-card tuning-service-card'), !matched && 'locked')}
            style={designCardStyle('tuning')}
            onPointerDown={(event) => startDesignCardMove('tuning', event)}
            onClick={() => designMode && onSelectDesignCard('tuning')}
          >
            {renderDesignHandle('tuning')}
            <StepTitle index={4} title="Select version & options" />
            {scanned ? (
              <div className="tuning-config">
                <div className="stage-list">
                  <span className="block-label">Stage / version</span>
                  {BASE_OPTIONS.map((option) => {
                    const status = baseOptionStatus(option.key);
                    const found = status === 'found';
                    const candidate = status === 'candidate';
                    const gainText = stageGainText(matchResult, option.key);
                    return (
                      <button
                        key={option.key}
                        type="button"
                        className={clsx('stage-option', baseTune === option.key && 'selected', found ? 'available' : 'requestable')}
                        onClick={() => setBaseTune((current) => (current === option.key ? '' : option.key))}
                      >
                        <span className="stage-radio" />
                        <div>
                          <strong>{option.label}</strong>
                          <small>{gainText || option.hint || (found ? 'Ready to build' : candidate ? 'Needs final validation' : 'Can be requested')}</small>
                        </div>
                        <em>{found ? 'Found' : candidate ? 'Check' : 'Request'}</em>
                      </button>
                    );
                  })}
                </div>
                <div className="options-list">
                  <div className="block-row">
                    <span className="block-label">Additional options</span>
                    <div className="block-tools">
                      <span className="selection-count">
                        {addons.length ? `${addons.length} selected` : 'None selected'}
                        {selectedUnavailableCount ? ` / ${selectedUnavailableCount} requestable` : ''}
                      </span>
                      {addonPageCount > 1 ? (
                        <div className="addon-pagination">
                          <button
                            type="button"
                            disabled={activeAddonPage === 0}
                            onClick={() => setAddonPage((page) => Math.max(0, page - 1))}
                          >
                            <ChevronLeft size={13} />
                          </button>
                          <span>{activeAddonPage + 1} / {addonPageCount}</span>
                          <button
                            type="button"
                            disabled={activeAddonPage >= addonPageCount - 1}
                            onClick={() => setAddonPage((page) => Math.min(addonPageCount - 1, page + 1))}
                          >
                            <ChevronRight size={13} />
                          </button>
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="addon-option-grid">
                    {visibleAddonOptions.map((option) => {
                      const status = addonOptionStatus(option.key);
                      const found = status === 'found';
                      const candidate = status === 'candidate';
                      const selected = addons.includes(option.key);
                      return (
                        <button
                          key={option.key}
                          type="button"
                          className={clsx('addon-tile', selected && 'selected', found ? 'available' : 'requestable')}
                          onClick={() => toggleAddon(option.key)}
                        >
                          <span className="addon-icon">{option.icon}</span>
                          <span className="addon-copy">
                            <strong>{option.label}</strong>
                            <small>{option.group}</small>
                            <em className="addon-availability">{found ? 'Found' : candidate ? 'Check' : 'Request'}</em>
                          </span>
                          <span className="addon-state">{selected ? <Check size={13} strokeWidth={3} /> : null}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : (
              <div className="locked-card-message">
                <Search size={18} />
                <span>{scanned ? 'No delivery options were found for this file.' : 'Scan the file before selecting versions and options.'}</span>
              </div>
            )}
          </section>

          <section className={designCardClass('summary', 'service-card summary-service-card')} style={designCardStyle('summary')} onPointerDown={(event) => startDesignCardMove('summary', event)} onClick={() => designMode && onSelectDesignCard('summary')}>
            {renderDesignHandle('summary')}
            <StepTitle index={5} title="Match & delivery" />
            <div className="summary-download-box" style={designInnerStyle('summary')}>
              <div className="selected-summary">
                <span>Selected summary</span>
                <ul>
                  <li>
                    <Check size={14} strokeWidth={3} />
                    <strong>{selectedBaseLabel}</strong>
                    <small>{selectedBaseGainText}</small>
                  </li>
                  {selectedAddonLabels.length ? (
                    selectedAddonLabels.map((label) => (
                      <li key={label}>
                        <Check size={14} strokeWidth={3} />
                        <strong>{label}</strong>
                        <small>{ADDON_OPTIONS.find((option) => option.label === label)?.group || ''}</small>
                      </li>
                    ))
                  ) : (
                    <li>
                      <Check size={14} strokeWidth={3} />
                    <strong>{scanned ? 'No additional options' : 'Pending scan'}</strong>
                      <small />
                    </li>
                  )}
                </ul>
                <div className="summary-meta">
                  <span>Estimated file size:</span>
                  <strong>{file ? formatFileSize(file.size) : 'Pending'}</strong>
                  <span>Package cost:</span>
                  <strong>Included</strong>
                  <span>Delivery:</span>
                  <strong>{scanned ? (hasRequestSelection ? 'Request required' : selectedCombinationCandidate ? 'Validation required' : 'Ready to build') : 'Pending'}</strong>
                </div>
              </div>
            </div>
            <div className="summary-footer">
              {error ? <div className="form-error">{error}</div> : null}
              {scanned ? (
                <button className="primary-action download-action" disabled={!canBuild} type="button" onClick={() => void submit()}>
                  {loading ? <Loader2 className="spin" size={17} /> : submitActionIcon}
                  {submitActionLabel}
                </button>
              ) : (
                <div className="summary-waiting">
                  <Info size={15} />
                  <span>Scan the file before matching.</span>
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

function DashboardPage({
  subscription,
  projects,
  builds,
  onNavigate,
}: {
  subscription: Subscription | null;
  projects: Project[];
  builds: BuildJob[];
  onNavigate: (page: PageKey) => void;
}) {
  const sortedBuilds = [...builds].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  const sortedProjects = [...projects].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  const readyBuilds = sortedBuilds.filter((build) => build.status === 'ready');
  const failedBuilds = sortedBuilds.filter((build) => build.status === 'failed');
  const activeBuilds = sortedBuilds.filter((build) => !['ready', 'failed'].includes(build.status));
  const used = subscription?.files_used_this_period || 0;
  const limit = subscription?.monthly_file_limit || 0;
  const unlimited = limit >= 9999;
  const freeUser = limit <= 0;
  const usagePercent = unlimited ? 100 : freeUser ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const remainingFiles = unlimited ? 'Unlimited' : String(Math.max(0, limit - used));
  const periodEnd = subscription ? new Date(subscription.period_ends_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Loading';
  const successRate = builds.length ? Math.round((readyBuilds.length / builds.length) * 100) : 100;
  const totalSourceSize = builds.reduce((sum, build) => sum + (build.source_size_bytes || 0), 0);
  const latestBuild = sortedBuilds[0];
  const pipelineRows = [
    { label: 'Queued / processing', value: activeBuilds.length, icon: <Activity size={16} />, tone: 'active' },
    { label: 'Ready for download', value: readyBuilds.length, icon: <Download size={16} />, tone: 'ready' },
    { label: 'Needs attention', value: failedBuilds.length, icon: <CircleAlert size={16} />, tone: failedBuilds.length ? 'failed' : 'quiet' },
  ];

  return (
    <div className="page-stack dashboard-page">
      <section className="workspace-panel dashboard-command-panel">
        <div className="dashboard-command-head">
          <div>
            <span>Command center</span>
            <h2>Workspace overview</h2>
            <p>Monitor monthly usage, file delivery, saved work and build activity from one place.</p>
          </div>
          <div className="dashboard-command-actions">
            {subscription ? <StatusBadge status={subscription.status} /> : null}
            <button type="button" className="primary-action compact" onClick={() => onNavigate('file-service')}>
              <Search size={15} />
              Match file
            </button>
          </div>
        </div>
        <div className="dashboard-metrics">
          <div className="metric-card">
            <FileCog size={18} />
            <span>Files this period</span>
            <strong>{unlimited ? `${used}` : freeUser ? 'Free' : `${used}/${limit}`}</strong>
          </div>
          <div className="metric-card">
            <FolderClock size={18} />
            <span>Saved files</span>
            <strong>{projects.length}</strong>
          </div>
          <div className="metric-card">
            <Download size={18} />
            <span>Ready downloads</span>
            <strong>{readyBuilds.length}</strong>
          </div>
          <div className="metric-card">
            <Activity size={18} />
            <span>In progress</span>
            <strong>{activeBuilds.length}</strong>
          </div>
        </div>
      </section>

      <div className="dashboard-operations-grid">
        <section className="workspace-panel dashboard-package-panel">
          <div className="section-heading">
            <div>
              <span>Subscription</span>
              <h2>{displayPackageName(subscription)}</h2>
            </div>
            <button type="button" className="secondary-action compact" onClick={() => onNavigate('packages')}>
              Packages
              <ChevronRight size={14} />
            </button>
          </div>
          <div className="dashboard-package-body">
            <div className="dashboard-package-primary">
              <span>{unlimited ? 'Unlimited delivery' : 'Remaining files'}</span>
              <strong>{remainingFiles}</strong>
              <small>{unlimited ? `${used} files processed this period` : `${used} of ${limit} files used`}</small>
            </div>
            <div className="dashboard-package-usage">
              <div className="job-title-row">
                <span>Usage this period</span>
                <strong>{unlimited ? 'Unlimited' : `${usagePercent}%`}</strong>
              </div>
              <div className="progress-bar large">
                <span style={{ width: `${usagePercent}%` }} />
              </div>
              <div className="usage-meta">
                <span>{unlimited ? 'No monthly cap' : `${remainingFiles} remaining`}</span>
                <span>Renews {periodEnd}</span>
              </div>
            </div>
          </div>
        </section>

        <section className="workspace-panel dashboard-pipeline-panel">
          <div className="section-heading">
            <div>
              <span>Delivery pipeline</span>
              <h2>Build status</h2>
            </div>
          </div>
          <div className="pipeline-list">
            {pipelineRows.map((row) => (
              <div className={clsx('pipeline-row', row.tone)} key={row.label}>
                {row.icon}
                <span>{row.label}</span>
                <strong>{row.value}</strong>
              </div>
            ))}
          </div>
        </section>

        <section className="workspace-panel dashboard-health-panel">
          <div className="section-heading">
            <div>
              <span>Workspace health</span>
              <h2>Quality snapshot</h2>
            </div>
          </div>
          <div className="health-grid">
            <div>
              <span>Ready rate</span>
              <strong>{successRate}%</strong>
            </div>
            <div>
              <span>Stored source size</span>
              <strong>{formatFileSize(totalSourceSize)}</strong>
            </div>
            <div>
              <span>Last activity</span>
              <strong>{latestBuild ? new Date(latestBuild.updated_at).toLocaleDateString() : 'No activity'}</strong>
            </div>
          </div>
        </section>
      </div>

      <div className="dashboard-work-grid">
        <section className="workspace-panel dashboard-main-list">
          <div className="section-heading">
            <div>
              <span>Recent activity</span>
              <h2>Latest builds</h2>
            </div>
            <button type="button" className="secondary-action compact" onClick={() => onNavigate('downloads')}>
              Downloads
            </button>
          </div>
          <BuildList builds={sortedBuilds.slice(0, 5)} emptyText="No builds yet." />
        </section>

        <section className="workspace-panel dashboard-side-list">
          <div className="section-heading">
            <div>
              <span>Saved work</span>
              <h2>Recent projects</h2>
            </div>
            <button type="button" className="secondary-action compact" onClick={() => onNavigate('my-files')}>
              My Files
            </button>
          </div>
          <div className="dashboard-project-list">
            {sortedProjects.slice(0, 4).map((project) => (
              <button type="button" key={project.id} onClick={() => onNavigate('my-files')}>
                <FolderClock size={15} />
                <span>
                  <strong>{project.name}</strong>
                  <small>{project.vehicle_label || project.ecu_label || 'Saved project'}</small>
                </span>
              </button>
            ))}
            {!sortedProjects.length ? (
              <div className="empty-state slim">
                <FolderClock size={28} />
                <strong>No saved projects yet</strong>
                <span>Saved files will appear here.</span>
              </div>
            ) : null}
          </div>
        </section>

        <section className="workspace-panel dashboard-actions-panel">
          <div className="section-heading">
            <div>
              <span>Quick actions</span>
              <h2>Next steps</h2>
            </div>
          </div>
          <div className="quick-actions-grid">
            <button type="button" onClick={() => onNavigate('file-service')}>
              <Search size={18} />
              <strong>Match a file</strong>
              <span>Upload an original ECU file and find available versions.</span>
            </button>
            <button type="button" onClick={() => onNavigate('my-files')}>
              <FolderClock size={18} />
              <strong>Open saved files</strong>
              <span>Continue from projects saved to your workspace.</span>
            </button>
            <button type="button" onClick={() => onNavigate('support')}>
              <Headphones size={18} />
              <strong>Contact support</strong>
              <span>Send details when a match needs manual help.</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}

function BuildList({ builds, emptyText }: { builds: BuildJob[]; emptyText: string }) {
  if (!builds.length) {
    return (
      <div className="empty-state slim">
        <FileCog size={28} />
        <strong>{emptyText}</strong>
        <span>New activity will appear here.</span>
      </div>
    );
  }

  return (
    <div className="table-list">
      {builds.map((build) => (
        <div className="table-row" key={build.id}>
          <div>
            <strong>{build.result_filename || build.source_filename}</strong>
            <span>{build.vehicle_label || build.ecu_label || 'Apex file build'}</span>
          </div>
          <div>{BASE_OPTION_LABELS[build.base_tune] || build.base_tune || 'Selected tune'}</div>
          <div><StatusBadge status={build.status} /></div>
        </div>
      ))}
    </div>
  );
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return 'Pending';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return 'Pending';
  return new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function projectAddonLabels(source: Project | BuildJob) {
  return readStringArray(source.requested_options?.addon_keys).map((key) => ADDON_OPTION_LABELS[key] || key);
}

function projectBaseTune(project: Project, build?: BuildJob | null) {
  const base = String(build?.base_tune || project.requested_options?.base_tune || '').trim();
  return baseTuneLabel(base, 'No stage selected');
}

function projectInternalComments(project: Project, build?: BuildJob | null) {
  const projectComment = String(project.requested_options?.comments || '').trim();
  const buildOptions = build?.requested_options as Record<string, unknown> | undefined;
  const buildComment = String(buildOptions?.comments || '').trim();
  return projectComment || buildComment || '';
}

function projectBuildHistory(project: Project, builds: BuildJob[]) {
  const linkedBuildIds = new Set(
    [
      project.last_build_id,
      String(project.requested_options?.build_id || ''),
      String(project.requested_options?.source_build_id || ''),
    ].filter(Boolean),
  );
  return builds
    .filter((build) => build.project_id === project.id || linkedBuildIds.has(build.id))
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
}

function projectWorkflowStatus(project: Project, build?: BuildJob | null) {
  if (!build && project.requested_options?.saved_from === 'delivery') return { key: 'ready', label: 'Built', status: 'ready' };
  if (build?.status === 'ready') return { key: 'ready', label: 'Built', status: 'ready' };
  if (build?.status === 'failed') return { key: 'failed', label: 'Needs attention', status: 'failed' };
  if (build && ['queued', 'scanning', 'building'].includes(build.status)) return { key: 'processing', label: 'Processing', status: build.status };
  if (project.requested_options?.request_file || project.requested_options?.status === 'requested') return { key: 'requested', label: 'Requested', status: 'queued' };
  return { key: 'saved', label: 'Saved', status: 'online' };
}

function projectDisplayFilename(project: Project, build?: BuildJob | null) {
  return (
    build?.result_filename ||
    String(project.requested_options?.result_filename || '') ||
    project.source_filename ||
    build?.source_filename ||
    'No filename saved'
  );
}

function projectRowModel(project: Project, builds: BuildJob[]) {
  const history = projectBuildHistory(project, builds);
  const latestBuild = history[0] || null;
  const status = projectWorkflowStatus(project, latestBuild);
  const addonLabels = latestBuild ? projectAddonLabels(latestBuild) : projectAddonLabels(project);
  const comments = projectInternalComments(project, latestBuild);
  const primaryFilename = projectDisplayFilename(project, latestBuild);
  return { project, history, latestBuild, status, addonLabels, comments, primaryFilename };
}

function projectSelectionSummary(project: Project, build?: BuildJob | null, addonLabels: string[] = []) {
  const base = projectBaseTune(project, build);
  const parts = [base, ...addonLabels].filter((item) => item && item !== 'No stage selected');
  return parts.length ? parts.join(' / ') : 'No version or options saved';
}

function ProjectDetailPage({
  project,
  builds,
  onBack,
  onProjectUpdated,
}: {
  project: Project;
  builds: BuildJob[];
  onBack: () => void;
  onProjectUpdated: (project: Project) => void;
}) {
  const { history, latestBuild, status, addonLabels, comments, primaryFilename } = projectRowModel(project, builds);
  const readyBuilds = history.filter((build) => build.status === 'ready');
  const vehicleLabel = project.vehicle_label || latestBuild?.vehicle_label || 'Not specified';
  const ecuLabel = project.ecu_label || latestBuild?.ecu_label || 'Not specified';
  const versionLabel = projectBaseTune(project, latestBuild);
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [editForm, setEditForm] = useState({
    name: project.name,
    vehicle_label: project.vehicle_label || latestBuild?.vehicle_label || '',
    ecu_label: project.ecu_label || latestBuild?.ecu_label || '',
    source_filename: project.source_filename || latestBuild?.source_filename || '',
    comments,
  });

  function beginProjectEdit() {
    setEditForm({
      name: project.name,
      vehicle_label: project.vehicle_label || latestBuild?.vehicle_label || '',
      ecu_label: project.ecu_label || latestBuild?.ecu_label || '',
      source_filename: project.source_filename || latestBuild?.source_filename || '',
      comments,
    });
    setSaveError('');
    setEditMode(true);
  }

  async function saveProjectEdits() {
    setSaving(true);
    setSaveError('');
    try {
      const requestedOptions = { ...(project.requested_options || {}), comments: editForm.comments.trim() };
      const updated = await updateProject(project.id, {
        name: editForm.name.trim() || project.name,
        vehicle_label: editForm.vehicle_label.trim(),
        ecu_label: editForm.ecu_label.trim(),
        source_filename: editForm.source_filename.trim(),
        requested_options: requestedOptions,
      });
      onProjectUpdated(updated);
      setEditMode(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Could not save project.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page-stack project-detail-page">
      <section className="project-page-header">
        <button type="button" className="secondary-action compact project-back-action" onClick={onBack}>
          <ChevronLeft size={15} />
          My Files
        </button>
        <div>
          <h1>{project.name}</h1>
          <p className="project-header-meta clean-meta">
            <span>{vehicleLabel}</span>
            <span>{ecuLabel}</span>
          </p>
          <p>{vehicleLabel} · {ecuLabel}</p>
        </div>
        <div className="project-page-state">
          {status.key === 'ready' ? null : <StatusBadge status={status.status} />}
          <span>Updated {formatShortDate(project.updated_at)}</span>
          {editMode ? (
            <div className="project-edit-actions">
              <button type="button" className="secondary-action compact" disabled={saving} onClick={() => setEditMode(false)}>
                Cancel
              </button>
              <button type="button" className="primary-action compact" disabled={saving} onClick={() => void saveProjectEdits()}>
                {saving ? <Loader2 className="spin" size={14} /> : <Check size={14} />}
                Save
              </button>
            </div>
          ) : (
            <button type="button" className="secondary-action compact project-edit-button" onClick={beginProjectEdit}>
              <SlidersHorizontal size={14} />
              Edit project
            </button>
          )}
        </div>
      </section>

      <div className="project-page-grid">
        <section className="workspace-panel project-primary-panel">
          <div className="section-heading compact-heading">
            <div>
              <span>Project file</span>
              <h2>Overview</h2>
            </div>
            {status.key === 'ready' ? null : <StatusBadge status={status.status} />}
          </div>

          {editMode ? (
            <div className="project-edit-form">
              <label>
                <span>Project name</span>
                <input value={editForm.name} onChange={(event) => setEditForm((current) => ({ ...current, name: event.target.value }))} />
              </label>
              <label>
                <span>Vehicle</span>
                <input value={editForm.vehicle_label} onChange={(event) => setEditForm((current) => ({ ...current, vehicle_label: event.target.value }))} />
              </label>
              <label>
                <span>ECU</span>
                <input value={editForm.ecu_label} onChange={(event) => setEditForm((current) => ({ ...current, ecu_label: event.target.value }))} />
              </label>
              <label>
                <span>Source filename</span>
                <input value={editForm.source_filename} onChange={(event) => setEditForm((current) => ({ ...current, source_filename: event.target.value }))} />
              </label>
              <label className="wide">
                <span>Comments</span>
                <textarea value={editForm.comments} onChange={(event) => setEditForm((current) => ({ ...current, comments: event.target.value }))} />
              </label>
              {saveError ? <div className="form-error wide">{saveError}</div> : null}
            </div>
          ) : (
            <div className="project-file-hero">
              <FileText size={24} />
              <div>
                <span>Primary file</span>
                <strong>{primaryFilename}</strong>
                <small>{latestBuild?.result_sha256 || project.source_sha256 || latestBuild?.source_sha256 || 'No checksum saved'}</small>
              </div>
            </div>
          )}

          <div className="project-facts-grid">
            <div>
              <span>Vehicle</span>
              <strong>{vehicleLabel}</strong>
            </div>
            <div>
              <span>ECU</span>
              <strong>{ecuLabel}</strong>
            </div>
            <div>
              <span>Version</span>
              <strong>{versionLabel}</strong>
            </div>
            <div>
              <span>Options</span>
              <strong>{addonLabels.length ? `${addonLabels.length} selected` : 'No additional options'}</strong>
            </div>
          </div>

          <div className="project-option-strip">
            <span>{versionLabel}</span>
            {addonLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
            {!addonLabels.length ? <span>No add-ons</span> : null}
          </div>
        </section>

        <aside className="workspace-panel project-download-panel">
          <div className="section-heading compact-heading">
            <div>
              <span>Delivery</span>
              <h2>Downloads</h2>
            </div>
            <strong>{readyBuilds.length}</strong>
          </div>

          <div className="project-download-state">
            <Download size={20} />
            <div>
              <strong>{readyBuilds.length ? `${readyBuilds.length} ready file${readyBuilds.length === 1 ? '' : 's'}` : 'No ready file yet'}</strong>
              <span>{status.key === 'requested' ? 'Requested files will appear here when completed.' : 'Built files can be downloaded again from this project.'}</span>
            </div>
          </div>

          <div className="project-download-list page-downloads">
            {readyBuilds.length ? (
              readyBuilds.map((build) => (
                <button key={build.id} type="button" onClick={() => void downloadBuild(build.id, build.result_filename)}>
                  <Download size={14} />
                  <span>{build.result_filename || build.source_filename}</span>
                </button>
              ))
            ) : (
              <div className="project-empty-note">Download buttons appear after a file is built.</div>
            )}
          </div>
        </aside>

        <section className="workspace-panel project-comments-card">
          <div className="section-heading compact-heading">
            <div>
              <span>Project details</span>
              <h2>Comments</h2>
            </div>
          </div>
          <p>{comments || 'No internal comments have been added to this project.'}</p>
        </section>

        <section className="workspace-panel project-activity-card">
          <div className="section-heading compact-heading">
            <div>
              <span>Project timeline</span>
              <h2>Activity</h2>
            </div>
          </div>
          <div className="project-timeline page-timeline">
            {history.map((build) => (
              <div key={build.id}>
                <i className={clsx(build.status === 'ready' && 'ready', build.status === 'failed' && 'failed')} />
                <div>
                  <strong>{build.status === 'ready' ? 'File built' : build.status === 'failed' ? 'Needs attention' : build.current_stage || build.status}</strong>
                  <small>{formatDateTime(build.updated_at)}</small>
                </div>
              </div>
            ))}
            {!history.length ? (
              <div>
                <i />
                <div>
                  <strong>Project saved</strong>
                  <small>{formatDateTime(project.created_at)}</small>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function MyFilesPage({
  projects,
  builds,
  onProjectUpdated,
}: {
  projects: Project[];
  builds: BuildJob[];
  onProjectUpdated: (project: Project) => void;
}) {
  const [query, setQuery] = useState('');
  const [sortMode, setSortMode] = useState<'updated' | 'created' | 'name' | 'status' | 'vehicle'>('updated');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  const projectRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const rows = projects.map((project) => {
      const row = projectRowModel(project, builds);
      const searchable = [
        project.name,
        project.vehicle_label,
        project.ecu_label,
        project.source_filename,
        row.primaryFilename,
        row.latestBuild?.source_filename,
        projectBaseTune(project, row.latestBuild),
        row.addonLabels.join(' '),
        row.status.label,
        row.comments,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return { ...row, searchable };
    });

    return rows
      .filter((row) => !normalizedQuery || row.searchable.includes(normalizedQuery))
      .sort((a, b) => {
        if (sortMode === 'name') return a.project.name.localeCompare(b.project.name);
        if (sortMode === 'vehicle') return (a.project.vehicle_label || '').localeCompare(b.project.vehicle_label || '');
        if (sortMode === 'status') return a.status.label.localeCompare(b.status.label);
        if (sortMode === 'created') return new Date(b.project.created_at).getTime() - new Date(a.project.created_at).getTime();
        return new Date(b.project.updated_at).getTime() - new Date(a.project.updated_at).getTime();
      });
  }, [projects, builds, query, sortMode]);

  const selectedProject = selectedProjectId ? projects.find((project) => project.id === selectedProjectId) || null : null;

  if (selectedProject) {
    return (
      <ProjectDetailPage
        project={selectedProject}
        builds={builds}
        onBack={() => setSelectedProjectId(null)}
        onProjectUpdated={onProjectUpdated}
      />
    );
  }

  return (
    <div className="page-stack my-files-page">
      <section className="workspace-panel full-panel my-files-panel">
        <div className="my-files-toolbar">
          <label className="my-files-search">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search project, vehicle, ECU, filename, option..." />
          </label>
          <label className="my-files-sort">
            <SlidersHorizontal size={15} />
            <select value={sortMode} onChange={(event) => setSortMode(event.target.value as typeof sortMode)}>
              <option value="updated">Last updated</option>
              <option value="created">Created date</option>
              <option value="name">Project name</option>
              <option value="vehicle">Vehicle</option>
              <option value="status">Status</option>
            </select>
          </label>
        </div>

        <div className="project-row-list">
          {projectRows.map(({ project, latestBuild, status, history, addonLabels }) => (
            <button className="project-row-card" key={project.id} type="button" onClick={() => setSelectedProjectId(project.id)}>
              <div className="project-row-main">
                <div className="project-file-icon">
                  {status.key === 'ready' ? <CheckCircle2 size={18} /> : status.key === 'failed' ? <CircleAlert size={18} /> : <FolderClock size={18} />}
                </div>
                <div>
                  <div className="project-row-title">
                    <strong>{project.name}</strong>
                  </div>
                  <span className="project-row-subtitle-clean">{project.vehicle_label || latestBuild?.vehicle_label || 'Vehicle not specified'} / {project.ecu_label || latestBuild?.ecu_label || 'ECU not specified'}</span>
                  <span className="project-row-subtitle">{project.vehicle_label || latestBuild?.vehicle_label || 'Vehicle not specified'} · {project.ecu_label || latestBuild?.ecu_label || 'ECU not specified'}</span>
                  <span>{project.vehicle_label || latestBuild?.vehicle_label || 'Vehicle not specified'} · {project.ecu_label || latestBuild?.ecu_label || 'ECU not specified'}</span>
                </div>
              </div>

              <div className="project-row-meta">
                <div>
                  <span>Selected</span>
                  <strong>{projectSelectionSummary(project, latestBuild, addonLabels)}</strong>
                </div>
                <div>
                  <span>Updated</span>
                  <strong>{formatShortDate(project.updated_at)}</strong>
                </div>
                <div>
                  <span>Builds</span>
                  <strong>{history.length}</strong>
                </div>
              </div>

              <div className="project-row-open">
                {status.key === 'ready' ? null : <StatusBadge status={status.status} />}
                <ChevronRight size={17} />
              </div>
            </button>
          ))}
        </div>

        {!projectRows.length ? (
          <div className="empty-state slim">
            <FolderClock size={28} />
            <strong>{projects.length ? 'No projects match your search' : 'No saved projects yet'}</strong>
            <span>{projects.length ? 'Try another filename, vehicle, status or option.' : 'Saved file builds will appear here.'}</span>
          </div>
        ) : null}

      </section>
    </div>
  );
}

function DownloadsPage({ builds }: { builds: BuildJob[] }) {
  const readyBuilds = builds.filter((build) => build.status === 'ready');

  return (
    <section className="workspace-panel full-panel">
      <div className="section-heading">
        <div>
          <span>Completed files</span>
          <h2>Downloads</h2>
        </div>
      </div>
      <div className="table-list">
        {readyBuilds.map((build) => (
          <div className="table-row downloads-row" key={build.id}>
            <div>
              <strong>{build.result_filename || build.source_filename}</strong>
              <span>{build.vehicle_label || build.ecu_label || 'Ready file'}</span>
            </div>
            <div>{new Date(build.updated_at).toLocaleDateString()}</div>
            <button type="button" className="primary-action compact-row-action" onClick={() => void downloadBuild(build.id, build.result_filename)}>
              <Download size={14} />
              Download
            </button>
          </div>
        ))}
        {!readyBuilds.length ? (
          <div className="empty-state slim">
            <Download size={28} />
            <strong>No completed downloads yet</strong>
            <span>Finished files will appear here.</span>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function PackagesPage({ subscription, onNavigate }: { subscription: Subscription | null; onNavigate: (page: PageKey) => void }) {
  const [packageMessage, setPackageMessage] = useState('');
  const used = subscription?.files_used_this_period || 0;
  const limit = subscription?.monthly_file_limit ?? 0;
  const unlimited = limit >= 9999;
  const percent = unlimited ? 100 : limit <= 0 ? 0 : Math.min(100, Math.round((used / limit) * 100));
  const currentPackageKey = packageKeyFromSubscription(subscription);
  const currentPackageIndex = PACKAGE_OPTIONS.findIndex((option) => option.key === currentPackageKey);
  const currentPackageName = displayPackageName(subscription);
  const renewLabel = subscription ? new Date(subscription.period_ends_at).toLocaleDateString() : 'Loading';

  return (
    <div className="page-stack packages-page">
      <section className="workspace-panel package-subscription-panel">
        <div className="section-heading">
          <div>
            <span>Subscription</span>
            <h2>Current package</h2>
          </div>
          {subscription ? <StatusBadge status={subscription.status} /> : null}
        </div>
        <div className="package-current-summary">
          <div>
            <div className="job-title-row">
              <span>Current package</span>
              <strong>{currentPackageName}</strong>
            </div>
            <p>{unlimited ? 'Unlimited monthly file delivery with reduced custom request pricing.' : `${Math.max(0, limit - used)} included files remaining this period`}</p>
          </div>
          {unlimited ? (
            <div className="package-current-stats">
              <div>
                <span>Files this period</span>
                <strong>{used}</strong>
              </div>
              <div>
                <span>Renews</span>
                <strong>{renewLabel}</strong>
              </div>
            </div>
          ) : (
            <>
              <div className="job-title-row package-usage-title">
                <span>Usage this period</span>
                <strong>{`${used}/${limit}`}</strong>
              </div>
              <div className="progress-bar large">
                <span style={{ width: `${percent}%` }} />
              </div>
              <div className="usage-meta">
                <span>{`${percent}% used`}</span>
                <span>{`Renews ${renewLabel}`}</span>
              </div>
            </>
          )}
          <button type="button" className="secondary-action compact package-payment-action" onClick={() => onNavigate('account')}>
            Manage payment details
            <ChevronRight size={15} />
          </button>
        </div>
      </section>

      <section className="pricing-card-grid package-pricing-grid" aria-label="Available packages">
        {PACKAGE_OPTIONS.map((option, index) => {
          const current = option.key === currentPackageKey;
          const featured = option.key === 'lite';
          const action = current ? 'Current package' : index > currentPackageIndex ? 'Upgrade' : currentPackageIndex > index ? 'Downgrade' : 'Select package';
          return (
            <article className={clsx('pricing-card', featured && 'featured', current && 'current')} key={option.key}>
              <div className="pricing-card-head">
                <span className="pricing-icon">{option.icon}</span>
                <div>
                  <span>{option.eyebrow}</span>
                  <strong>{option.name}</strong>
                </div>
                {current ? <em>Current</em> : featured ? <em>Featured</em> : null}
              </div>
              <div className="pricing-price">
                <strong>${option.price}</strong>
                <span>/ month</span>
              </div>
              <p>{option.description}</p>
              <div className="pricing-rates">
                <div>
                  <span>Included files</span>
                  <strong>{option.includedFiles === 'unlimited' ? 'Unlimited' : option.includedFiles}</strong>
                </div>
                <div>
                  <span>Extra files</span>
                  <strong>{option.extraFilePrice ? `$${option.extraFilePrice}` : 'Included'}</strong>
                </div>
                <div>
                  <span>New file requests</span>
                  <strong>{option.customRequestPrice ? `$${option.customRequestPrice}` : 'Not included'}</strong>
                </div>
              </div>
              <ul>
                {option.features.map((feature) => (
                  <li key={feature}>
                    <Check size={14} />
                    {feature}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className={clsx(current ? 'secondary-action' : 'primary-action', 'pricing-action')}
                disabled={current}
                onClick={() => setPackageMessage(`${option.name} selected. Your package change will be confirmed before your subscription is updated.`)}
              >
                {action}
              </button>
            </article>
          );
        })}
      </section>

      <div className="package-footer-row">
        <div>
          <ShieldCheck size={17} />
          <strong>{packageMessage ? 'Package selected' : 'Package changes'}</strong>
          <span>{packageMessage || 'Choose the package that matches your monthly file volume. Your active subscription controls the included file allowance shown above.'}</span>
        </div>
      </div>
    </div>
  );
}

function SupportPage({ user }: { user: User }) {
  return (
    <section className="workspace-panel full-panel">
      <div className="section-heading">
        <div>
          <span>Help desk</span>
          <h2>Support</h2>
        </div>
        <StatusBadge status="online" />
      </div>
      <div className="support-grid">
        <div className="support-card">
          <Headphones size={20} />
          <strong>File matching help</strong>
          <span>Send the file name, vehicle details and what result you expected.</span>
        </div>
        <div className="support-card">
          <FileCog size={20} />
          <strong>Build issue</strong>
          <span>Include the completed file name and selected options.</span>
        </div>
        <div className="support-card">
          <Gauge size={20} />
          <strong>Package question</strong>
          <span>Ask about usage, renewals or changing your monthly package.</span>
        </div>
      </div>
      <div className="support-form-panel">
        <label>
          <span>Account</span>
          <input readOnly value={user.email} />
        </label>
        <label>
          <span>Topic</span>
          <select defaultValue="file-match">
            <option value="file-match">File match</option>
            <option value="build">Build delivery</option>
            <option value="package">Package</option>
          </select>
        </label>
        <label className="support-message">
          <span>Message</span>
          <textarea placeholder="Describe what you need help with." />
        </label>
        <button type="button" className="primary-action support-send">
          <Headphones size={16} />
          Send request
        </button>
      </div>
    </section>
  );
}

function SettingsPage({ user }: { user: User }) {
  return (
    <section className="workspace-panel full-panel">
      <div className="section-heading">
        <div>
          <span>Preferences</span>
          <h2>Settings</h2>
        </div>
      </div>
      <div className="settings-grid settings-page-grid">
        <label>
          <span>Display name</span>
          <input defaultValue={user.display_name || ''} />
        </label>
        <label>
          <span>Company</span>
          <input defaultValue={user.company_name || ''} />
        </label>
        <label>
          <span>VAT number</span>
          <input defaultValue={user.vat_number || ''} />
        </label>
        <label>
          <span>Country</span>
          <input defaultValue={user.country || ''} />
        </label>
        <label>
          <span>Phone</span>
          <input defaultValue={user.phone_number || ''} />
        </label>
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
    </section>
  );
}

function AccountPage({ subscription, user }: { subscription: Subscription | null; user: User }) {
  const [tab, setTab] = useState<'profile' | 'package' | 'settings'>('profile');
  const used = subscription?.files_used_this_period || 0;
  const limit = subscription?.monthly_file_limit ?? 0;
  const unlimited = limit >= 9999;
  const freeUser = limit <= 0;
  const percent = unlimited ? 100 : freeUser ? 0 : Math.min(100, Math.round((used / limit) * 100));

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
            <div className="profile-block">
              <span>VAT</span>
              <strong>{user.vat_number || 'Not set'}</strong>
              <p>{user.country || 'Country not set'}</p>
            </div>
            <div className="profile-block">
              <span>Phone</span>
              <strong>{user.phone_number || 'Not set'}</strong>
              <p>{displayPackageName(subscription, user)}</p>
            </div>
          </>
        ) : null}
        {tab === 'package' ? (
          <>
            <div className="plan-block">
              <span>Current package</span>
              <strong>{displayPackageName(subscription, user)}</strong>
              <p>{unlimited ? `${used} files processed this period` : freeUser ? '1 included file each month' : `${used} of ${limit} files used this period`}</p>
            </div>
            <div className="usage-block account-wide">
              <div className="progress-bar large">
                <span style={{ width: `${unlimited ? 100 : percent}%` }} />
              </div>
              <div className="usage-meta">
                <span>{unlimited ? 'Unlimited package' : freeUser ? 'Apex Free' : `${percent}% used`}</span>
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
  if (page === 'dashboard') return 'Dashboard';
  if (page === 'my-files') return 'My Files';
  if (page === 'downloads') return 'Downloads';
  if (page === 'packages') return 'Packages';
  if (page === 'support') return 'Support';
  if (page === 'settings') return 'Settings';
  if (page === 'account') return 'Account';
  return 'File service';
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(readToken()));
  const [activePage, setActivePage] = useState<PageKey>('file-service');
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [builds, setBuilds] = useState<BuildJob[]>([]);
  const [currentJob, setCurrentJob] = useState<BuildJob | null>(null);
  const [downloadedJobIds, setDownloadedJobIds] = useState<Set<string>>(() => new Set());
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [designMode, setDesignMode] = useState(false);
  const [designPreviewActive, setDesignPreviewActive] = useState(true);
  const [designConfig, setDesignConfig] = useState<DesignLabConfig>(() => readDesignLabConfig());
  const [selectedDesignCard, setSelectedDesignCard] = useState<DesignCardKey>('upload');
  const [selectedDesignLoginCard, setSelectedDesignLoginCard] = useState<DesignLoginKey>('auth');
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

  function logout() {
    clearToken();
    setUser(null);
    setSubscription(null);
    setProjects([]);
    setBuilds([]);
    setCurrentJob(null);
    setDeliveryOpen(false);
    setDownloadedJobIds(new Set());
    setActivePage('file-service');
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

  useEffect(() => {
    if (!designPreviewActive) return;
    void window.apex
      ?.setMinimumSize?.({
        width: designConfig.global.windowMinWidth,
        height: designConfig.global.windowMinHeight,
      })
      .then(() => window.apex?.setBounds?.({
        width: designConfig.global.windowWidth,
        height: designConfig.global.windowHeight,
      }))
      .then((bounds) => bounds || window.apex?.getBounds())
      .then((bounds) => {
        if (bounds) setWindowBounds(bounds);
      });
  }, [
    designPreviewActive,
    designConfig.global.windowMinWidth,
    designConfig.global.windowMinHeight,
    designConfig.global.windowWidth,
    designConfig.global.windowHeight,
  ]);

  useEffect(() => {
    document.body.classList.toggle('body-design-active', designPreviewActive);
    if (designPreviewActive) {
      document.body.style.setProperty('--design-window-min-width', `${designConfig.global.windowMinWidth}px`);
      document.body.style.setProperty('--design-window-min-height', `${designConfig.global.windowMinHeight}px`);
      return;
    }
    document.body.style.removeProperty('--design-window-min-width');
    document.body.style.removeProperty('--design-window-min-height');
    return undefined;
  }, [designPreviewActive, designConfig.global.windowMinWidth, designConfig.global.windowMinHeight]);

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
      if (typeof patch.topRowHeight === 'number') {
        const cardHeight = Math.max(120, Math.round(patch.topRowHeight - 2));
        DESIGN_TOP_ROW_CARDS.forEach((key) => {
          draft.cards[key].height = cardHeight;
        });
      }
      if (typeof patch.lowerRowMinHeight === 'number') {
        const cardHeight = Math.max(120, Math.round(patch.lowerRowMinHeight - 4));
        DESIGN_LOWER_ROW_CARDS.forEach((key) => {
          draft.cards[key].height = cardHeight;
        });
      }
    }, recordHistory);
  }, [updateDesignConfig]);

  const updateDesignCard = useCallback((key: DesignCardKey, patch: Partial<DesignCardConfig>, recordHistory = true) => {
    updateDesignConfig((draft) => {
      if (typeof patch.height === 'number' && DESIGN_LOWER_ROW_CARDS.includes(key)) {
        const { height, ...cardSpecificPatch } = patch;
        DESIGN_LOWER_ROW_CARDS.forEach((rowKey) => {
          draft.cards[rowKey] = {
            ...draft.cards[rowKey],
            ...(rowKey === key ? cardSpecificPatch : {}),
            height,
          };
        });
        draft.global.lowerRowMinHeight = Math.max(120, Math.round(height + 4));
        return;
      }
      draft.cards[key] = { ...draft.cards[key], ...patch };
    }, recordHistory);
  }, [updateDesignConfig]);

  const updateDesignLoginCard = useCallback((key: DesignLoginKey, patch: Partial<DesignCardConfig>, recordHistory = true) => {
    updateDesignConfig((draft) => {
      draft.login[key] = { ...draft.login[key], ...patch };
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
    setSelectedDesignLoginCard('auth');
  }, [updateDesignConfig]);

  const activeDesignSurface: DesignSurface = !user ? 'login' : activePage === 'file-service' ? 'file-service' : 'app-page';
  const activeDesignSurfaceLabel = !user ? 'Login page' : activePage === 'file-service' ? 'File service' : pageTitle(activePage);
  const activeDesignSelectedCard =
    activeDesignSurface === 'login'
      ? selectedDesignLoginCard
      : activeDesignSurface === 'file-service'
        ? selectedDesignCard
        : '';

  const postDesignLabState = useCallback((target = designWindowRef.current) => {
    if (!target || target.closed) return;
    target.postMessage(
      {
        source: 'apex-design-lab-host',
        config: designConfig,
        surface: activeDesignSurface,
        surfaceLabel: activeDesignSurfaceLabel,
        selectedCard: activeDesignSelectedCard,
        canUndo: Boolean(designPast.length),
        canRedo: Boolean(designFuture.length),
        windowBounds,
      },
      '*',
    );
  }, [activeDesignSelectedCard, activeDesignSurface, activeDesignSurfaceLabel, designConfig, designPast.length, designFuture.length, windowBounds]);

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
        key?: DesignCardKey | DesignLoginKey;
        surface?: DesignSurface;
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
      if (data.type === 'select-card' && data.key) {
        if (DESIGN_LOGIN_KEYS.includes(data.key as DesignLoginKey)) {
          setSelectedDesignLoginCard(data.key as DesignLoginKey);
          return;
        }
        if (DESIGN_CARD_KEYS.includes(data.key as DesignCardKey)) {
          setSelectedDesignCard(data.key as DesignCardKey);
          return;
        }
      }
      if (data.type === 'update-global' && data.patch) {
        updateDesignGlobal(data.patch as Partial<DesignLabConfig['global']>);
        return;
      }
      if (data.type === 'update-card' && data.key && data.patch) {
        if (DESIGN_LOGIN_KEYS.includes(data.key as DesignLoginKey)) {
          updateDesignLoginCard(data.key as DesignLoginKey, data.patch as Partial<DesignCardConfig>);
          return;
        }
        if (DESIGN_CARD_KEYS.includes(data.key as DesignCardKey)) {
          updateDesignCard(data.key as DesignCardKey, data.patch as Partial<DesignCardConfig>);
          return;
        }
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
  }, [postDesignLabState, updateDesignGlobal, updateDesignCard, updateDesignLoginCard, undoDesignChange, redoDesignChange, resetDesignConfig]);

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
    if (activePage === 'dashboard') {
      return <DashboardPage subscription={subscription} projects={projects} builds={builds} onNavigate={setActivePage} />;
    }
    if (activePage === 'my-files') {
      return (
        <MyFilesPage
          projects={projects}
          builds={builds}
          onProjectUpdated={(project) => setProjects((items) => items.map((item) => (item.id === project.id ? project : item)))}
        />
      );
    }
    if (activePage === 'downloads') return <DownloadsPage builds={builds} />;
    if (activePage === 'packages') return <PackagesPage subscription={subscription} onNavigate={setActivePage} />;
    if (activePage === 'support' && user) return <SupportPage user={user} />;
    if (activePage === 'settings' && user) return <SettingsPage user={user} />;
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
        onFileChanged={() => {
          setCurrentJob(null);
          setDeliveryOpen(false);
        }}
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

  const designShellStyle = designPreviewActive
    ? ({
        '--design-font-family': configFontFamily(designConfig.global.fontFamily),
        '--design-font-weight': designConfig.global.fontBold ? 700 : 400,
        '--design-base-font-size': `${designConfig.global.baseFontSize}px`,
        '--design-title-font-size': `${designConfig.global.titleFontSize}px`,
        '--design-label-font-size': `${designConfig.global.labelFontSize}px`,
        '--design-workspace-padding-x': `${designConfig.global.workspacePaddingX}px`,
        '--design-workspace-padding-y': `${designConfig.global.workspacePaddingY}px`,
        '--design-header-height': `${designConfig.global.headerHeight}px`,
        '--design-sidebar-width': `${designConfig.global.sidebarWidth}px`,
        '--design-grid-gap': `${designConfig.global.gridGap}px`,
        '--design-page-bg': designConfig.global.pageBackground,
        '--design-workspace-bg': designConfig.global.workspaceBackground,
        '--design-header-bg': designConfig.global.headerBackground,
        '--design-sidebar-bg': designConfig.global.sidebarBackground,
        '--design-accent': designConfig.global.accentColor,
        '--design-text': designConfig.global.textColor,
        '--design-muted': designConfig.global.mutedColor,
        '--design-window-min-width': `${designConfig.global.windowMinWidth}px`,
        '--design-window-min-height': `${designConfig.global.windowMinHeight}px`,
        '--design-window-width': `${designConfig.global.windowWidth}px`,
        '--design-window-height': `${designConfig.global.windowHeight}px`,
        '--accent': designConfig.global.accentColor,
      } as CSSProperties)
    : undefined;

  if (loading) {
    return (
      <div className="boot-screen">
        <div className="login-background" aria-hidden="true" />
        <LoginParticles />
        <ApexLogo variant="lockup" />
        <Loader2 className="spin" size={22} />
      </div>
    );
  }

  if (!user) {
    return (
      <div className={clsx('login-app-shell', designPreviewActive && 'login-app-shell-design-open')} style={designShellStyle}>
        <TopChrome user={null} />
        <LoginScreen
          designMode={designMode}
          designActive={designPreviewActive}
          designConfig={designConfig}
          selectedDesignLoginCard={selectedDesignLoginCard}
          onSelectDesignLoginCard={setSelectedDesignLoginCard}
          onDesignLoginCardChange={updateDesignLoginCard}
          onDesignHistoryPoint={markDesignHistoryPoint}
          onAuthed={(nextUser) => {
            setUser(nextUser);
            void refreshData();
          }}
        />
      </div>
    );
  }

  return (
    <div className={clsx('app-shell', designPreviewActive && 'app-shell-design-open')} style={designShellStyle}>
      <TopChrome user={user} subscription={subscription} onNavigate={setActivePage} onLogout={logout} />
      <Sidebar
        active={activePage}
        onChange={setActivePage}
        subscription={subscription}
      />
      <main className="workspace">
        {activePage !== 'file-service' ? (
          <div className="workspace-heading">
            <div>
              <span>Apex workspace</span>
              <h1>{pageTitle(activePage)}</h1>
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
          onRetried={(job) => {
            setCurrentJob(job);
            setDeliveryOpen(true);
            void refreshData();
          }}
        />
      ) : null}
    </div>
  );
}
