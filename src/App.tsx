import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';
import clsx from 'clsx';
import {
  Activity,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Database,
  Download,
  FileCog,
  FolderClock,
  Gauge,
  Loader2,
  LockKeyhole,
  LogOut,
  Minus,
  MonitorCog,
  PanelsTopLeft,
  Play,
  Settings,
  Square,
  Upload,
  UserPlus,
  X,
} from 'lucide-react';
import {
  BuildJob,
  IntegrationStatus,
  Project,
  Subscription,
  User,
  clearToken,
  createBuild,
  downloadBuild,
  getBuild,
  getIntegrationStatus,
  getMe,
  getSubscription,
  listBuilds,
  listProjects,
  login,
  readToken,
  register,
} from './lib/api';

type PageKey = 'builder' | 'projects' | 'subscription' | 'services';

const BASE_OPTIONS = [
  { key: 'STAGE1', label: 'Stage 1' },
  { key: 'STAGE2', label: 'Stage 2' },
  { key: 'CUSTOM', label: 'Custom' },
  { key: 'ECO', label: 'ECO' },
  { key: 'TCU', label: 'TCU' },
];

const ADDON_OPTIONS = [
  { key: 'EGR_OFF', label: 'EGR off' },
  { key: 'DPF_OFF', label: 'DPF off' },
  { key: 'DECAT', label: 'Decat' },
  { key: 'SWIRL_FLAPS_OFF', label: 'Swirl flaps off' },
  { key: 'ADBLUE_OFF', label: 'Adblue off' },
  { key: 'VMAX', label: 'V-max' },
];

function ApexLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className={clsx('apex-logo', compact && 'apex-logo-compact')}>
      <div className="apex-mark">
        <span />
      </div>
      {!compact ? (
        <div className="min-w-0">
          <div className="apex-word">Apex Files</div>
          <div className="apex-powered">Powered by Revtech</div>
        </div>
      ) : null}
    </div>
  );
}

function WindowControls() {
  return (
    <div className="window-controls app-no-drag">
      <button aria-label="Minimize" onClick={() => void window.apex?.minimize()}>
        <Minus size={14} />
      </button>
      <button aria-label="Maximize" onClick={() => void window.apex?.maximizeToggle()}>
        <Square size={12} />
      </button>
      <button aria-label="Close" className="close" onClick={() => void window.apex?.close()}>
        <X size={15} />
      </button>
    </div>
  );
}

function Titlebar({ user }: { user: User | null }) {
  return (
    <header className="titlebar app-drag">
      <div className="titlebar-left">
        <PanelsTopLeft size={16} />
        <span>Apex Files</span>
      </div>
      <div className="titlebar-right app-no-drag">
        {user ? <span className="session-pill">{user.company_name || user.email}</span> : null}
        <WindowControls />
      </div>
    </header>
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
      <div className="login-backplate" />
      <form className="login-panel" onSubmit={onSubmit}>
        <ApexLogo />
        <div className="login-copy">
          <h1>{mode === 'login' ? 'Sign in' : 'Create account'}</h1>
          <p>{mode === 'login' ? 'Access your tuner workspace.' : 'Start a new Apex Files workspace.'}</p>
        </div>
        <label>
          <span>Email</span>
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" />
        </label>
        {mode === 'register' ? (
          <>
            <label>
              <span>Name</span>
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <label>
              <span>Company</span>
              <input value={companyName} onChange={(event) => setCompanyName(event.target.value)} />
            </label>
          </>
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
        <button className="primary-button" disabled={loading}>
          {loading ? <Loader2 className="spin" size={16} /> : mode === 'login' ? <LockKeyhole size={16} /> : <UserPlus size={16} />}
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <button type="button" className="ghost-button" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
          {mode === 'login' ? 'Create account' : 'Back to sign in'}
        </button>
      </form>
    </main>
  );
}

function Sidebar({
  active,
  onChange,
  onLogout,
}: {
  active: PageKey;
  onChange: (page: PageKey) => void;
  onLogout: () => void;
}) {
  const items = [
    { key: 'builder' as const, label: 'File builder', icon: FileCog },
    { key: 'projects' as const, label: 'Projects', icon: FolderClock },
    { key: 'subscription' as const, label: 'Subscription', icon: Gauge },
    { key: 'services' as const, label: 'Services', icon: MonitorCog },
  ];

  return (
    <aside className="sidebar">
      <ApexLogo />
      <nav>
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button key={item.key} className={clsx(active === item.key && 'active')} onClick={() => onChange(item.key)}>
              <Icon size={18} />
              <span>{item.label}</span>
              <ChevronRight className="nav-chevron" size={14} />
            </button>
          );
        })}
      </nav>
      <button className="sidebar-logout" onClick={onLogout}>
        <LogOut size={16} />
        Sign out
      </button>
    </aside>
  );
}

function StatusBadge({ status }: { status: string }) {
  const ready = status === 'ready';
  const failed = status === 'failed';
  return (
    <span className={clsx('status-badge', ready && 'ready', failed && 'failed')}>
      {ready ? <CheckCircle2 size={13} /> : failed ? <CircleAlert size={13} /> : <Activity size={13} />}
      {status}
    </span>
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
      setError(reason instanceof Error ? reason.message : 'Could not start build');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="page-grid builder-grid">
      <section className="panel builder-panel">
        <div className="section-heading">
          <div>
            <span>Build</span>
            <h2>Requested customer file</h2>
          </div>
          <button className="icon-button" onClick={() => fileInput.current?.click()} title="Select file">
            <Upload size={18} />
          </button>
        </div>
        <input
          ref={fileInput}
          type="file"
          className="hidden-input"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
        <button className={clsx('drop-target', file && 'has-file')} onClick={() => fileInput.current?.click()}>
          <Upload size={26} />
          <strong>{file ? file.name : 'Select calibration file'}</strong>
          <span>{file ? `${Math.round(file.size / 1024).toLocaleString()} KB` : 'BIN, ORI, MOD or tool export'}</span>
        </button>

        <div className="field-grid">
          <label>
            <span>Vehicle</span>
            <input value={vehicle} onChange={(event) => setVehicle(event.target.value)} placeholder="BMW 320d F30" />
          </label>
          <label>
            <span>ECU</span>
            <input value={ecu} onChange={(event) => setEcu(event.target.value)} placeholder="EDC17C50" />
          </label>
        </div>

        <div className="option-block">
          <span className="block-label">Base tune</span>
          <div className="segmented">
            {BASE_OPTIONS.map((option) => (
              <button
                key={option.key}
                className={clsx(baseTune === option.key && 'selected')}
                onClick={() => setBaseTune(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="option-block">
          <span className="block-label">Add-ons</span>
          <div className="addon-grid">
            {ADDON_OPTIONS.map((option) => (
              <button key={option.key} className={clsx(addons.includes(option.key) && 'selected')} onClick={() => toggleAddon(option.key)}>
                <span className="check-dot">{addons.includes(option.key) ? <CheckCircle2 size={14} /> : null}</span>
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="project-row">
          <label className="toggle-row">
            <input type="checkbox" checked={saveProject} onChange={(event) => setSaveProject(event.target.checked)} />
            <span>Save as project</span>
          </label>
          <input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Project name" />
        </div>

        {error ? <div className="form-error">{error}</div> : null}
        <button className="primary-button build-button" disabled={!file || loading} onClick={() => void submit()}>
          {loading ? <Loader2 className="spin" size={17} /> : <Play size={17} />}
          Match and build
        </button>
      </section>

      <section className="panel result-panel">
        <div className="section-heading">
          <div>
            <span>Delivery</span>
            <h2>Build status</h2>
          </div>
          {currentJob ? <StatusBadge status={currentJob.status} /> : null}
        </div>
        {currentJob ? (
          <div className="job-card">
            <div className="progress-ring" style={{ '--progress': `${currentJob.progress}%` } as CSSProperties}>
              <span>{currentJob.progress}%</span>
            </div>
            <div className="job-main">
              <h3>{currentJob.source_filename}</h3>
              <p>{currentJob.current_stage}</p>
              <div className="progress-bar">
                <span style={{ width: `${currentJob.progress}%` }} />
              </div>
              <div className="job-meta">
                <span>{currentJob.strategy || 'pending strategy'}</span>
                <span>{currentJob.result_sha256 ? currentJob.result_sha256.slice(0, 12) : currentJob.source_sha256.slice(0, 12)}</span>
              </div>
              {currentJob.error_message ? <div className="form-error">{currentJob.error_message}</div> : null}
              {currentJob.status === 'ready' ? (
                <button className="primary-button" onClick={() => void downloadBuild(currentJob.id, currentJob.result_filename)}>
                  <Download size={16} />
                  Download file
                </button>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <Database size={34} />
            <span>No active build</span>
          </div>
        )}
      </section>
    </div>
  );
}

function ProjectsPage({ projects, builds }: { projects: Project[]; builds: BuildJob[] }) {
  return (
    <section className="panel full-panel">
      <div className="section-heading">
        <div>
          <span>Workspace</span>
          <h2>Projects and recent builds</h2>
        </div>
      </div>
      <div className="table-list">
        {[...projects].map((project) => {
          const build = builds.find((item) => item.id === project.last_build_id);
          return (
            <div className="table-row" key={project.id}>
              <div>
                <strong>{project.name}</strong>
                <span>{project.vehicle_label || project.source_filename || 'Unlabeled project'}</span>
              </div>
              <div>{project.ecu_label || 'ECU pending'}</div>
              <div>{build ? <StatusBadge status={build.status} /> : <span className="muted">No build</span>}</div>
            </div>
          );
        })}
        {!projects.length ? <div className="empty-state slim">No saved projects yet</div> : null}
      </div>
    </section>
  );
}

function SubscriptionPage({ subscription }: { subscription: Subscription | null }) {
  const used = subscription?.files_used_this_period || 0;
  const limit = subscription?.monthly_file_limit || 1;
  const percent = Math.min(100, Math.round((used / limit) * 100));
  return (
    <section className="panel full-panel">
      <div className="section-heading">
        <div>
          <span>Profile</span>
          <h2>Subscription</h2>
        </div>
        {subscription ? <StatusBadge status={subscription.status} /> : null}
      </div>
      {subscription ? (
        <div className="subscription-layout">
          <div className="plan-block">
            <span>Current package</span>
            <strong>{subscription.plan_name}</strong>
            <p>
              {used} of {limit} files used
            </p>
          </div>
          <div className="usage-block">
            <div className="progress-bar large">
              <span style={{ width: `${percent}%` }} />
            </div>
            <div className="job-meta">
              <span>{percent}% used</span>
              <span>Renews {new Date(subscription.period_ends_at).toLocaleDateString()}</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="empty-state slim">Subscription loading</div>
      )}
    </section>
  );
}

function ServicesPage({ status }: { status: IntegrationStatus | null }) {
  const ok = Boolean(status?.configured && status?.health);
  return (
    <section className="panel full-panel">
      <div className="section-heading">
        <div>
          <span>Infrastructure</span>
          <h2>Revtech services</h2>
        </div>
        <span className={clsx('status-badge', ok && 'ready', !ok && 'failed')}>
          {ok ? <CheckCircle2 size={13} /> : <CircleAlert size={13} />}
          {ok ? 'connected' : 'attention'}
        </span>
      </div>
      <div className="service-grid">
        <div>
          <span>Mode</span>
          <strong>{status?.mode || 'loading'}</strong>
        </div>
        <div>
          <span>Endpoint</span>
          <strong>{status?.revtech_api_base_url || '-'}</strong>
        </div>
        <div>
          <span>WinOLS</span>
          <strong>{String((status?.health?.winols_service as { status?: string } | undefined)?.status || 'pending')}</strong>
        </div>
        <div>
          <span>Message</span>
          <strong>{status?.message || 'OK'}</strong>
        </div>
      </div>
    </section>
  );
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(Boolean(readToken()));
  const [activePage, setActivePage] = useState<PageKey>('builder');
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [builds, setBuilds] = useState<BuildJob[]>([]);
  const [currentJob, setCurrentJob] = useState<BuildJob | null>(null);
  const [integration, setIntegration] = useState<IntegrationStatus | null>(null);

  async function refreshData() {
    const [subscriptionData, projectsData, buildsData, integrationData] = await Promise.all([
      getSubscription().catch(() => null),
      listProjects().catch(() => []),
      listBuilds().catch(() => ({ items: [] })),
      getIntegrationStatus().catch(() => null),
    ]);
    setSubscription(subscriptionData);
    setProjects(projectsData);
    setBuilds(buildsData.items);
    setIntegration(integrationData);
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

  function logout() {
    clearToken();
    setUser(null);
  }

  const page = useMemo(() => {
    if (activePage === 'projects') return <ProjectsPage projects={projects} builds={builds} />;
    if (activePage === 'subscription') return <SubscriptionPage subscription={subscription} />;
    if (activePage === 'services') return <ServicesPage status={integration} />;
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
  }, [activePage, builds, currentJob, integration, projects, subscription]);

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
        <Titlebar user={null} />
        <LoginScreen
          onAuthed={(nextUser) => {
            setUser(nextUser);
            void refreshData();
          }}
        />
      </>
    );
  }

  return (
    <div className="app-shell">
      <Titlebar user={user} />
      <div className="app-body">
        <Sidebar active={activePage} onChange={setActivePage} onLogout={logout} />
        <main className="content">
          <div className="content-heading">
            <div>
              <span>{activePage}</span>
              <h1>{activePage === 'builder' ? 'File builder' : activePage === 'projects' ? 'Projects' : activePage === 'subscription' ? 'Subscription' : 'Services'}</h1>
            </div>
            <div className="top-metric">
              <Settings size={15} />
              {subscription ? `${subscription.files_used_this_period}/${subscription.monthly_file_limit} files` : 'Loading'}
            </div>
          </div>
          {page}
        </main>
      </div>
    </div>
  );
}
