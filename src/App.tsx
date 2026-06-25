import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import clsx from 'clsx';
import {
  Activity,
  Bell,
  Bolt,
  CheckCircle2,
  CircleAlert,
  Download,
  FileCog,
  FileText,
  FolderClock,
  FolderPlus,
  Gauge,
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
  Play,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Upload,
  UserPlus,
  Wrench,
  X,
  Zap,
} from 'lucide-react';
import {
  BuildJob,
  Project,
  Subscription,
  User,
  clearToken,
  createBuild,
  downloadBuild,
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

function buildOptionSummary(baseTune: string, addonKeys: string[]) {
  const base = BASE_OPTION_LABELS[baseTune] || 'Stage 1';
  if (!addonKeys.length) return base;
  return `${base} + ${addonKeys.map((key) => ADDON_OPTION_LABELS[key] || key).join(', ')}`;
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

function TopChrome({ user }: { user: User | null }) {
  return (
    <>
      <div className="app-drag drag-strip" />
      <div className="top-chrome">
        {user ? (
          <div className="top-session">
            <span>{user.company_name || user.display_name || user.email}</span>
          </div>
        ) : null}
        <WindowActions />
      </div>
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
}: {
  active: PageKey;
  collapsed: boolean;
  onChange: (page: PageKey) => void;
  onLogout: () => void;
  onToggleCollapsed: () => void;
}) {
  const items: { key: PageKey; label: string; icon: ReactNode }[] = [
    { key: 'builder', label: 'File builder', icon: <FileCog size={17} /> },
    { key: 'projects', label: 'Projects', icon: <FolderClock size={17} /> },
    { key: 'account', label: 'Account', icon: <ShieldCheck size={17} /> },
  ];

  return (
    <aside className={clsx('sidebar', collapsed && 'collapsed')}>
      <div className="sidebar-inner">
        <div className="sidebar-brand">
          <ApexLogo compact={collapsed} />
        </div>
        <nav>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className={clsx(active === item.key && 'active')}
              title={collapsed ? item.label : undefined}
              onClick={() => onChange(item.key)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
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

function BuildCompleteModal({ job, onClose }: { job: BuildJob; onClose: () => void }) {
  return (
    <ModalShell eyebrow="Delivery" title="File ready" icon={<CheckCircle2 size={18} />} onClose={onClose}>
      <div className="finished-summary">
        <div>
          <span>Completed file</span>
          <strong>{job.result_filename || job.source_filename}</strong>
        </div>
        <div>
          <span>Source</span>
          <strong>{job.source_filename}</strong>
        </div>
        <div>
          <span>Tune</span>
          <strong>{buildOptionSummary(job.base_tune, job.requested_options?.addon_keys || [])}</strong>
        </div>
      </div>
      <div className="success-panel">
        <CheckCircle2 size={18} />
        <span>Your file is ready to download.</span>
      </div>
      <div className="modal-actions">
        <button className="quiet-action" type="button" onClick={onClose}>
          Close
        </button>
        <button className="primary-action" type="button" onClick={() => void downloadBuild(job.id, job.result_filename)}>
          <Download size={16} />
          Download file
        </button>
      </div>
    </ModalShell>
  );
}

function BuilderPage({
  onCreated,
  currentJob,
}: {
  onCreated: (job: BuildJob) => void;
  currentJob: BuildJob | null;
}) {
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [baseTune, setBaseTune] = useState('STAGE1');
  const [addons, setAddons] = useState<string[]>([]);
  const [vehicle, setVehicle] = useState('');
  const [ecu, setEcu] = useState('');
  const [saveProject, setSaveProject] = useState(true);
  const [projectName, setProjectName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [projectDetailsOpen, setProjectDetailsOpen] = useState(false);

  function toggleAddon(key: string) {
    setAddons((current) => (current.includes(key) ? current.filter((item) => item !== key) : [...current, key]));
  }

  async function submit() {
    if (!file) return;
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

  const selectedBase = BASE_OPTIONS.find((option) => option.key === baseTune)?.label || 'Stage 1';
  const currentBaseLabel = BASE_OPTION_LABELS[currentJob?.base_tune || baseTune] || selectedBase;
  const currentAddonKeys = currentJob?.requested_options?.addon_keys || addons;
  const currentAddonLabels = currentAddonKeys.map((key) => ADDON_OPTION_LABELS[key] || key).filter(Boolean);
  const selectedOptionSummary = buildOptionSummary(baseTune, addons);

  return (
    <>
      <div className="builder-layout">
        <section className="workspace-panel builder-panel">
        <div className="section-heading">
          <div>
            <span>Upload file</span>
            <h2>Build a customer file</h2>
          </div>
          <div className="builder-heading-actions">
            <button className="secondary-action compact" type="button" onClick={() => setProjectDetailsOpen(true)}>
              <FolderPlus size={15} />
              Project details
            </button>
            <button className="icon-action" type="button" onClick={() => fileInput.current?.click()} title="Select file">
              <Upload size={18} />
            </button>
          </div>
        </div>
        <input
          ref={fileInput}
          type="file"
          className="hidden-input"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
        <button className={clsx('drop-target', file && 'has-file')} type="button" onClick={() => fileInput.current?.click()}>
          <Upload size={26} />
          <strong>{file ? file.name : 'Select file'}</strong>
          <span>{file ? `${formatFileSize(file.size)} selected` : 'BIN, ORI, MOD or tool export'}</span>
        </button>

        <div className="builder-summary-strip">
          <div>
            <span>Project</span>
            <strong>{projectName || vehicle || file?.name || 'Not named yet'}</strong>
          </div>
          <div>
            <span>Vehicle / ECU</span>
            <strong>{[vehicle || 'Vehicle pending', ecu || 'ECU pending'].join(' / ')}</strong>
          </div>
          <button type="button" className="secondary-action compact" onClick={() => setProjectDetailsOpen(true)}>
            <Info size={14} />
            Edit details
          </button>
        </div>

        <div className="option-block">
          <span className="block-label">Requested tune</span>
          <div className="tune-card-grid">
            {BASE_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={clsx('tune-card', baseTune === option.key && 'selected')}
                onClick={() => setBaseTune(option.key)}
              >
                <span className="tune-icon">{option.icon}</span>
                <strong>{option.label}</strong>
                <small>{option.hint}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="option-block">
          <div className="block-row">
            <span className="block-label">Options</span>
            <span className="selection-count">{addons.length ? `${addons.length} selected` : 'No add-ons'}</span>
          </div>
          <div className="addon-grid">
            {ADDON_OPTIONS.map((option) => (
              <button
                key={option.key}
                type="button"
                className={clsx('addon-chip', addons.includes(option.key) && 'selected')}
                onClick={() => toggleAddon(option.key)}
              >
                <span className="addon-state">{addons.includes(option.key) ? <CheckCircle2 size={13} /> : <Wrench size={13} />}</span>
                <span className="addon-copy">
                  <strong>{option.label}</strong>
                  <small>{option.group}</small>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div className="build-review">
          <div>
            <span>Request</span>
            <strong>{selectedOptionSummary}</strong>
          </div>
          <div>
            <span>Project</span>
            <strong>{saveProject ? 'Will be saved' : 'One-time build'}</strong>
          </div>
        </div>

        {error ? <div className="form-error">{error}</div> : null}
        <button className="primary-action build-action" disabled={!file || loading} type="button" onClick={() => void submit()}>
          {loading ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
          Start file build
        </button>
        </section>

        <section className="workspace-panel result-panel">
        <div className="section-heading">
          <div>
            <span>Delivery</span>
            <h2>Current build</h2>
          </div>
          {currentJob ? <StatusBadge status={currentJob.status} /> : null}
        </div>
        {currentJob ? (
          <div className="job-card">
            <div className="job-main">
              <div className="job-title-row">
                <h3>{currentJob.source_filename}</h3>
                <strong>{currentJob.progress}%</strong>
              </div>
              <div className="progress-bar delivery-progress">
                <span style={{ width: `${currentJob.progress}%` }} />
              </div>
              <div className="delivery-meta">
                <span>{currentJob.current_stage}</span>
                <span>{currentJob.status === 'ready' ? 'Download ready' : currentJob.status === 'failed' ? 'Needs attention' : 'Building'}</span>
              </div>
              <dl className="build-summary">
                <div>
                  <dt>Tune</dt>
                  <dd>{currentBaseLabel}</dd>
                </div>
                <div>
                  <dt>Options</dt>
                  <dd>{currentAddonLabels.length ? currentAddonLabels.join(', ') : 'None'}</dd>
                </div>
              </dl>
              {currentJob.error_message ? <div className="form-error">{currentJob.error_message}</div> : null}
              {currentJob.status === 'ready' ? (
                <button className="primary-action" type="button" onClick={() => void downloadBuild(currentJob.id, currentJob.result_filename)}>
                  <Download size={16} />
                  Download file
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <FileCog size={34} />
            <strong>No active build</strong>
            <span>Select a file and choose the requested options.</span>
          </div>
        )}
        </section>
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
  return 'File builder';
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
  const [finishedJob, setFinishedJob] = useState<BuildJob | null>(null);
  const lastFinishedJobId = useRef<string | null>(null);

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
    if (lastFinishedJobId.current === currentJob.id) return;
    lastFinishedJobId.current = currentJob.id;
    setFinishedJob(currentJob);
  }, [currentJob]);

  function logout() {
    clearToken();
    setUser(null);
    setProjects([]);
    setBuilds([]);
    setCurrentJob(null);
    setFinishedJob(null);
    setSubscription(null);
    setActivePage('builder');
  }

  const page = useMemo(() => {
    if (activePage === 'projects') return <ProjectsPage projects={projects} builds={builds} />;
    if (activePage === 'account' && user) return <AccountPage subscription={subscription} user={user} />;
    return (
      <BuilderPage
        currentJob={currentJob}
        onCreated={(job) => {
          setCurrentJob(job);
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
      <TopChrome user={user} />
      <Sidebar
        active={activePage}
        collapsed={sidebarCollapsed}
        onChange={setActivePage}
        onLogout={logout}
        onToggleCollapsed={() => setSidebarCollapsed((current) => !current)}
      />
      <main className="workspace">
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
        {page}
      </main>
      {finishedJob ? <BuildCompleteModal job={finishedJob} onClose={() => setFinishedJob(null)} /> : null}
    </div>
  );
}
