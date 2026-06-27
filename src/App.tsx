import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, FormEvent, ReactNode } from 'react';
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
  Eye,
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
  LogOut,
  Maximize2,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
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
      <header className="app-header app-no-drag">
        <div className="header-brand">
          <ApexLogo />
          <div className="header-divider" />
          <span>Professional ECU Calibration. Unlimited Potential.</span>
        </div>
        <div className="header-actions">
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
  collapsed,
  onChange,
  onLogout,
  onToggleCollapsed,
  subscription,
}: {
  active: PageKey;
  collapsed: boolean;
  onChange: (page: PageKey) => void;
  onLogout: () => void;
  onToggleCollapsed: () => void;
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
    <aside className={clsx('sidebar', collapsed && 'collapsed')}>
      <div className="sidebar-inner">
        <nav>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={clsx(item.activeWhen === active && 'active', item.accent && 'accent')}
              title={collapsed ? item.label : undefined}
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
          <button type="button" className="sidebar-collapse" onClick={onToggleCollapsed} title={collapsed ? 'Expand menu' : undefined}>
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
            <span>{collapsed ? 'Expand menu' : 'Collapse menu'}</span>
          </button>
          <div className="sidebar-footer">
            <button type="button" className="logout-button" onClick={onLogout} title={collapsed ? 'Log out' : undefined}>
              <LogOut size={16} />
              <span>Log out</span>
            </button>
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

function ProjectDetailsModal({
  file,
  vehicle,
  ecu,
  projectName,
  saveProject,
  onVehicle,
  onEcu,
  onProjectName,
  onSaveProject,
  onClose,
}: {
  file: File | null;
  vehicle: string;
  ecu: string;
  projectName: string;
  saveProject: boolean;
  onVehicle: (value: string) => void;
  onEcu: (value: string) => void;
  onProjectName: (value: string) => void;
  onSaveProject: (value: boolean) => void;
  onClose: () => void;
}) {
  return (
    <ModalShell eyebrow="Project" title="Project details" icon={<FolderPlus size={18} />} onClose={onClose}>
      <div className="detail-grid">
        <label>
          <span>Project name</span>
          <input value={projectName} onChange={(event) => onProjectName(event.target.value)} placeholder={file?.name || 'Customer build'} />
        </label>
        <label>
          <span>Vehicle</span>
          <input value={vehicle} onChange={(event) => onVehicle(event.target.value)} placeholder="BMW 320d F30" />
        </label>
        <label>
          <span>ECU</span>
          <input value={ecu} onChange={(event) => onEcu(event.target.value)} placeholder="EDC17C50" />
        </label>
        <label className="toggle-row setting-toggle">
          <input type="checkbox" checked={saveProject} onChange={(event) => onSaveProject(event.target.checked)} />
          <span>Save to projects</span>
        </label>
      </div>
      <div className="modal-file-strip">
        <FileText size={16} />
        <div>
          <strong>{file?.name || 'No file selected'}</strong>
          <span>{file ? formatFileSize(file.size) : 'Select a file before starting a build'}</span>
        </div>
      </div>
    </ModalShell>
  );
}

function BuildDeliveryModal({ job, onClose }: { job: BuildJob; onClose: () => void }) {
  const ready = job.status === 'ready';
  const failed = job.status === 'failed';
  const addonLabels = (job.requested_options?.addon_keys || []).map((key) => ADDON_OPTION_LABELS[key] || key).filter(Boolean);

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
          <span>Status</span>
          <strong>{job.current_stage}</strong>
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
      <div className="delivery-modal-progress">
        <div className="job-title-row">
          <span>{failed ? 'Stopped' : ready ? 'Complete' : 'Working'}</span>
          <strong>{job.progress}%</strong>
        </div>
        <div className="progress-bar delivery-progress">
          <span style={{ width: `${job.progress}%` }} />
        </div>
      </div>
      {job.error_message ? <div className="form-error">{job.error_message}</div> : null}
      {ready ? (
        <div className="success-panel">
          <CheckCircle2 size={18} />
          <span>Your file is ready to download.</span>
        </div>
      ) : null}
      <div className="modal-actions">
        <button className="quiet-action" type="button" onClick={onClose}>
          Close
        </button>
        <button className="primary-action" type="button" disabled={!ready} onClick={() => void downloadBuild(job.id, job.result_filename)}>
          <Download size={16} />
          {ready ? 'Download file' : 'Preparing'}
        </button>
      </div>
    </ModalShell>
  );
}

function BuilderPage({
  onCreated,
  currentJob,
  onOpenDelivery,
}: {
  onCreated: (job: BuildJob) => void;
  currentJob: BuildJob | null;
  onOpenDelivery: () => void;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [matchResult, setMatchResult] = useState<BuildMatch | null>(null);
  const [baseTune, setBaseTune] = useState('');
  const [addons, setAddons] = useState<string[]>([]);
  const [vehicle, setVehicle] = useState('');
  const [ecu, setEcu] = useState('');
  const [saveProject, setSaveProject] = useState(true);
  const [projectName, setProjectName] = useState('');
  const [matchLoading, setMatchLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [projectDetailsOpen, setProjectDetailsOpen] = useState(false);

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
        if (!projectName.trim() && result.project_name) setProjectName(result.project_name);
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
        save_project: saveProject,
        project_name: projectName || vehicle || file.name,
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
  const matched = Boolean(matchResult?.matched);
  const selectedBaseLabel = baseTune ? BASE_OPTION_LABELS[baseTune] || baseTune : 'Pending';
  const selectedAddonLabels = addons.map((key) => ADDON_OPTION_LABELS[key] || key);
  const vehicleDisplay = matchResult?.vehicle_label || vehicle || 'Pending';
  const ecuDisplay = matchResult?.ecu_label || ecu || 'Pending';
  const brandDisplay = vehicleBrand(vehicleDisplay);
  const modelDisplay = vehicleModel(vehicleDisplay);
  const engineDisplay = engineLabel(vehicleDisplay);
  const softwareDisplay = matched ? softwareNumber(file?.name || matchResult?.source_filename) : 'Pending';
  const hardwareDisplay = matched ? 'Matched' : 'Pending';
  const matchStatusText = matchLoading
    ? 'Analyzing file'
    : matched
      ? 'Match confirmed'
      : matchResult
        ? 'No matching version found'
        : file
          ? 'Ready to match'
          : 'Choose a file to start';

  return (
    <>
      <div className="builder-layout">
        <div className="file-service-grid">
          <section className="service-card upload-service-card">
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

          <section className="service-card match-service-card">
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

          <section className="service-card results-service-card">
            <div className="card-title-row">
              <StepTitle index={3} title="File match results" />
              <span className={clsx('result-chip', matched && 'confirmed', matchResult && !matched && 'failed')}>
                {matched ? 'Match confirmed' : matchResult ? 'No match' : 'Waiting'}
              </span>
            </div>
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
            <button className="secondary-action compact details-action" type="button" onClick={() => setProjectDetailsOpen(true)}>
              View details
              <Eye size={15} />
            </button>
          </section>

          <section className={clsx('service-card tuning-service-card', !matched && 'locked')}>
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

          <section className="service-card summary-service-card">
            <StepTitle index={5} title="Summary & download" />
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
            {currentJob ? (
              <button className="secondary-action compact delivery-action" type="button" onClick={onOpenDelivery}>
                <Activity size={15} />
                Open delivery
              </button>
            ) : null}
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
      {projectDetailsOpen ? (
        <ProjectDetailsModal
          file={file}
          vehicle={vehicle}
          ecu={ecu}
          projectName={projectName}
          saveProject={saveProject}
          onVehicle={setVehicle}
          onEcu={setEcu}
          onProjectName={setProjectName}
          onSaveProject={setSaveProject}
          onClose={() => setProjectDetailsOpen(false)}
        />
      ) : null}
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [builds, setBuilds] = useState<BuildJob[]>([]);
  const [currentJob, setCurrentJob] = useState<BuildJob | null>(null);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const lastReadyJobId = useRef<string | null>(null);

  async function refreshData() {
    const [subscriptionData, projectsData, buildsData] = await Promise.all([
      getSubscription().catch(() => null),
      listProjects().catch(() => []),
      listBuilds().catch(() => ({ items: [] })),
    ]);
    setSubscription(subscriptionData);
    setProjects(projectsData);
    setBuilds(buildsData.items);
    setCurrentJob((current) => current || buildsData.items[0] || null);
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

  function logout() {
    clearToken();
    setUser(null);
    setProjects([]);
    setBuilds([]);
    setCurrentJob(null);
    setDeliveryOpen(false);
    setSubscription(null);
    setActivePage('builder');
  }

  const page = useMemo(() => {
    if (activePage === 'projects') return <ProjectsPage projects={projects} builds={builds} />;
    if (activePage === 'account' && user) return <AccountPage subscription={subscription} user={user} />;
    return (
      <BuilderPage
        currentJob={currentJob}
        onOpenDelivery={() => setDeliveryOpen(true)}
        onCreated={(job) => {
          setCurrentJob(job);
          setDeliveryOpen(true);
          setBuilds((items) => [job, ...items]);
          void refreshData();
        }}
      />
    );
  }, [activePage, builds, currentJob, projects, subscription, user]);

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

  return (
    <div className="app-shell">
      <TopChrome user={user} subscription={subscription} />
      <Sidebar
        active={activePage}
        collapsed={sidebarCollapsed}
        onChange={setActivePage}
        onLogout={logout}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
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
      {deliveryOpen && currentJob ? <BuildDeliveryModal job={currentJob} onClose={() => setDeliveryOpen(false)} /> : null}
    </div>
  );
}
