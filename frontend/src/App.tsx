import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronRight, CircleHelp, ClipboardList, Clock3, FileJson, FlaskConical, GraduationCap, Heart, HeartHandshake, History, LayoutDashboard, Leaf, LoaderCircle, LockKeyhole, LogOut, Menu, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Stethoscope, Trash2, Upload, Users, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ApiError, canAssess, canPredict, downloadJson, parseImport, request, validateValues } from './api';
import type { FeatureSchema, Health, Payload, Prediction, Resource, Role, User, Validation } from './api';

type Page = 'overview' | 'library' | 'assessment' | 'history' | 'about';
type Notice = { kind: 'success' | 'error' | 'info'; text: string };
type SessionEntry = { id: string; time: string; payload: Payload; status: 'Validated' | 'Awaiting model' | 'Completed'; prediction?: Prediction };
const roles: { id: Role; label: string; description: string; icon: LucideIcon; tag: string; color: string }[] = [
  { id: 'patient', label: 'Patients', description: 'Understand breast health, find reliable answers, and prepare for conversations with your care team.', icon: Heart, tag: 'Understand & feel informed', color: 'rose' },
  { id: 'student', label: 'Students', description: 'Build your foundations with guided reading and a hands-on measurement practice workspace.', icon: GraduationCap, tag: 'Learn & put it into practice', color: 'lavender' },
  { id: 'researcher', label: 'Researchers', description: 'Explore study design, data quality, and a structured workspace for future assessment tools.', icon: FlaskConical, tag: 'Explore & investigate', color: 'sage' },
  { id: 'doctor', label: 'Doctors', description: 'Review clinical resources and prepare measurement inputs in a focused professional workspace.', icon: Stethoscope, tag: 'Review & assess', color: 'sand' },
];
const pageNames: Record<Page, string> = { overview: 'Overview', library: 'Learning library', assessment: 'Assessment room', history: 'Session history', about: 'About the project' };
const formatRole = (role: Role) => role === 'doctor' ? 'Doctor' : role[0].toUpperCase() + role.slice(1);

function BotanicalArt() {
  return <svg className="botanical-art" viewBox="0 0 430 360" fill="none" aria-hidden="true">
    <circle cx="227" cy="172" r="138" fill="#eedddd" fillOpacity=".62" />
    <circle cx="227" cy="172" r="115" stroke="#d8b8c2" strokeOpacity=".55" strokeDasharray="3 8" />
    <path d="M218 310c27-57 26-126 14-186" stroke="#997d80" strokeWidth="2" />
    <path d="M237 247c-20-25-58-30-62-5 5 26 37 28 62 5Z" fill="#afb9a5" />
    <path d="M241 214c24-24 62-36 69-12 0 24-38 38-69 12Z" fill="#c1c9b3" />
    <path d="M237 170c-21-24-48-25-52-6 3 19 30 25 52 6Z" fill="#c6ccba" />
    <path d="M229 119c-48-5-70-36-54-53 18-19 44 4 54 53Z" fill="#d89eac" />
    <path d="M229 119c-32-36-32-74-9-76 27-2 30 33 9 76Z" fill="#dfb4bd" />
    <path d="M229 119c0-49 24-78 44-65 22 15 1 47-44 65Z" fill="#bc7188" />
    <path d="M229 119c36-34 73-31 74-7 1 26-36 30-74 7Z" fill="#dca5b3" />
    <path d="M229 119c45 4 68 30 53 48-17 21-42-3-53-48Z" fill="#d4a0ad" />
    <path d="M229 119c29 37 28 72 5 73-24 2-28-32-5-73Z" fill="#e4bdc5" />
    <path d="M229 119c-3 46-28 71-46 57-20-16 5-44 46-57Z" fill="#c17e94" />
    <path d="M229 119c-37 28-71 20-69-3 3-25 35-24 69 3Z" fill="#e7c5cd" />
    <circle cx="229" cy="119" r="13" fill="#94736f" />
    <circle cx="229" cy="119" r="7" fill="#eed8b8" />
    <path d="M124 286c21-27 30-64 23-87" stroke="#b5a095" strokeWidth="1.5" />
    <ellipse cx="139" cy="230" rx="8" ry="18" transform="rotate(-39 139 230)" fill="#d5cbbb" />
    <ellipse cx="158" cy="250" rx="8" ry="18" transform="rotate(34 158 250)" fill="#c7c7b3" />
    <circle cx="126" cy="108" r="4" fill="#c790a3" /><circle cx="333" cy="253" r="3" fill="#c790a3" />
    <path d="M336 81v14m-7-7h14M101 248v12m-6-6h12" stroke="#bd899d" strokeWidth="1.5" />
    <path d="M298 308h-139" stroke="#d1bbc1" strokeWidth="1.5" />
  </svg>;
}

function Modal({ title, children, close, wide = false }: { title: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
      if (event.key !== 'Tab') return;
      const elements = ref.current?.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex="0"]');
      if (!elements?.length) return;
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', onKey); previous?.focus(); };
  }, [close]);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1} ref={ref}>
      <div className="modal-header"><h2 id="modal-title">{title}</h2><button className="icon-button" onClick={close} aria-label="Close dialog"><X size={20} /></button></div>
      {children}
    </div>
  </div>;
}

function ResourceCard({ resource, onOpen, saved, onSave }: { resource: Resource; onOpen: () => void; saved: boolean; onSave: () => void }) {
  return <article className="resource-card">
    <div className="resource-top"><span className="resource-icon"><BookOpen size={20} /></span><span className="eyebrow">{resource.category}</span>
      <button className={`icon-button save-button ${saved ? 'is-saved' : ''}`} onClick={onSave} aria-label={saved ? `Unsave ${resource.title}` : `Save ${resource.title}`} aria-pressed={saved}>{saved ? <Check size={16} /> : <Plus size={16} />}</button>
    </div>
    <h3><button className="text-button card-title" onClick={onOpen}>{resource.title}</button></h3>
    <p>{resource.summary}</p>
    <div className="resource-footer"><span><Clock3 size={13} /> {resource.reading_minutes} min read</span><button className="text-button resource-link" onClick={onOpen}>Read article <ArrowUpRight size={16} /></button></div>
  </article>;
}

export default function App() {
  const [page, setPage] = useState<Page>('overview');
  const [mobileNav, setMobileNav] = useState(false);
  const sessionEpoch = useRef(0);
  const [identityReady, setIdentityReady] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [schema, setSchema] = useState<FeatureSchema | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [resources, setResources] = useState<Resource[]>([]);
  const [libraryLoading, setLibraryLoading] = useState(true);
  const [libraryError, setLibraryError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All resources');
  const [saved, setSaved] = useState<string[]>([]);
  const [article, setArticle] = useState<Resource | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register' | null>(null);
  const [authRole, setAuthRole] = useState<Role>('patient');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState('');
  const [notice, setNotice] = useState<Notice | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [sampleId, setSampleId] = useState('');
  const [group, setGroup] = useState('mean');
  const [busy, setBusy] = useState(false);
  const [validated, setValidated] = useState(false);
  const [modelPending, setModelPending] = useState(false);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [history, setHistory] = useState<SessionEntry[]>([]);
  const [isExample, setIsExample] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const accessible = canAssess(user);
  const predictionAllowed = canPredict(user);
  const activeRole = roles.find(role => role.id === user?.role);

  const connect = useCallback(async () => {
    setConnecting(true);
    const results = await Promise.allSettled([request<Health>('/health'), request<FeatureSchema>('/features')]);
    setHealth(results[0].status === 'fulfilled' ? results[0].value : null);
    if (results[1].status === 'fulfilled') setSchema(results[1].value);
    setConnecting(false);
  }, []);
  useEffect(() => {
    void connect();
    let active = true;
    const epoch = sessionEpoch.current;
    void request<{ user: User }>('/auth/me').then(data => {
      if (active && sessionEpoch.current === epoch) setUser(data.user);
    }).catch(async error => {
      if (active && sessionEpoch.current === epoch && error instanceof ApiError && error.status === 401) {
        await request('/auth/logout', { method: 'POST' }).catch(() => {});
      }
    }).finally(() => { if (active) setIdentityReady(true); });
    return () => { active = false; };
  }, [connect]);
  useEffect(() => {
    if (!identityReady) return;
    let cancelled = false;
    setLibraryLoading(true); setLibraryError(''); setArticle(null); setResources([]);
    void request<{ resources: Resource[] }>('/library').then(data => { if (!cancelled) setResources(data.resources); })
      .catch(async error => {
        if (cancelled) return;
        if (error instanceof ApiError && error.status === 401) {
          sessionEpoch.current += 1;
          try {
            await request('/auth/logout', { method: 'POST' });
            if (cancelled) return;
            setUser(null); setHistory([]); setSaved([]); resetAssessment();
            const publicLibrary = await request<{ resources: Resource[] }>('/library');
            if (!cancelled) setResources(publicLibrary.resources);
          } catch (recoveryError) { if (!cancelled) setLibraryError((recoveryError as Error).message); }
        } else setLibraryError(error.message);
      })
      .finally(() => { if (!cancelled) setLibraryLoading(false); });
    return () => { cancelled = true; };
  }, [user, identityReady]);
  useEffect(() => { if (!accessible && (page === 'assessment' || page === 'history')) setPage('overview'); }, [accessible, page]);
  useEffect(() => { setNotice(null); window.scrollTo({ top: 0, behavior: 'instant' }); }, [page]);

  const closeAuth = useCallback(() => { if (!authBusy) { setAuthMode(null); setAuthError(''); } }, [authBusy]);
  const closeArticle = useCallback(() => setArticle(null), []);
  const openAuth = (mode: 'login' | 'register', role: Role = 'patient') => { setAuthRole(role); setAuthError(''); setAuthMode(mode); };
  const navigate = (next: Page) => { setPage(next); setMobileNav(false); };
  const notify = (kind: Notice['kind'], text: string) => setNotice({ kind, text });
  const toggleSaved = (id: string) => setSaved(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  const resetAssessment = () => { setValues({}); setErrors({}); setSampleId(''); setValidated(false); setModelPending(false); setPrediction(null); setIsExample(false); setGroup('mean'); };
  const handleLogout = async () => {
    sessionEpoch.current += 1;
    setAuthBusy(true);
    try {
      await request('/auth/logout', { method: 'POST' });
      setUser(null); setPage('overview');
    } catch {
      notify('error', 'The API is unavailable. Session data was cleared; reconnect to finish signing out.');
    } finally {
      setHistory([]); setSaved([]); resetAssessment(); setAuthBusy(false);
    }
  };
  const handleAuth = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const credentials = { username: String(data.get('username')).trim(), password: String(data.get('password')) };
    sessionEpoch.current += 1;
    setAuthBusy(true); setAuthError('');
    try {
      if (authMode === 'register') await request('/auth/register', { method: 'POST', body: JSON.stringify({ ...credentials, role: authRole }) });
      const result = await request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify(credentials) });
      setUser(result.user); setHistory([]); setSaved([]); resetAssessment(); setAuthMode(null); setPage('overview');
      notify('success', result.user.approved ? `Welcome, ${result.user.username}. Your workspace is ready.` : 'Account created. Professional tools will become available after account approval.');
    } catch (error) { setAuthError((error as Error).message); }
    finally { setAuthBusy(false); }
  };

  const filled = schema ? schema.features.filter(field => values[field.name]?.trim() && Number.isFinite(Number(values[field.name])) && Number(values[field.name]) >= field.minimum).length : 0;
  const loadExample = () => {
    if (!schema) return;
    const base = [14, 20, 90, 600, 0.1, 0.12, 0.08, 0.04, 0.18, 0.06];
    const example: Record<string, string> = {};
    schema.features.forEach((field, index) => { example[field.name] = String(Number((base[index % 10] * (field.group === 'se' ? 0.04 : field.group === 'worst' ? 1.2 : 1)).toPrecision(6))); });
    setValues(example); setSampleId('EXAMPLE-001'); setErrors({}); setValidated(false); setModelPending(false); setPrediction(null); setIsExample(true);
    notify('info', 'Synthetic example loaded for interface testing. These values do not represent a person or a diagnosis.');
  };
  const currentPayload = (): Payload => ({ sample_id: sampleId.trim() || null, features: Object.fromEntries((schema?.feature_order || []).map(name => [name, Number(values[name])])) });
  const checkInputs = () => {
    if (!schema) return false;
    const nextErrors = validateValues(values, schema); setErrors(nextErrors);
    const first = Object.keys(nextErrors)[0];
    if (first) { setGroup(schema.features.find(field => field.name === first)?.group || 'mean'); notify('error', 'Complete the highlighted measurements before continuing.'); return false; }
    return true;
  };
  const submitAssessment = async (requestPrediction: boolean) => {
    if (!checkInputs()) return;
    const epoch = sessionEpoch.current;
    setBusy(true); setPrediction(null); setModelPending(false); setNotice(null);
    const payload = currentPayload();
    const entry: SessionEntry = { id: crypto.randomUUID(), time: new Date().toISOString(), payload, status: 'Validated' };
    try {
      await request<Validation>('/validate', { method: 'POST', body: JSON.stringify(payload) });
      if (sessionEpoch.current !== epoch) return;
      setValidated(true);
      if (requestPrediction) {
        try {
          const result = await request<Prediction>('/predict', { method: 'POST', body: JSON.stringify(payload) });
          if (sessionEpoch.current !== epoch) return;
          if (result.status !== 'completed' || !['benign', 'malignant'].includes(result.prediction) || (result.probability !== null && (!Number.isFinite(result.probability) || result.probability < 0 || result.probability > 1))) throw new Error('The prediction response does not match the supported API contract.');
          setPrediction(result); entry.status = 'Completed'; entry.prediction = result;
          notify('success', 'Assessment response received.');
        } catch (error) {
          if (sessionEpoch.current !== epoch) return;
          if (error instanceof ApiError && error.code === 'MODEL_NOT_CONFIGURED') {
            setModelPending(true); entry.status = 'Awaiting model'; notify('info', 'Your inputs are valid. Prediction results will be available after the model is connected.');
          } else throw error;
        }
      } else notify('success', 'All measurements passed API validation. You can now export your inputs.');
      if (sessionEpoch.current !== epoch) return;
      setHistory(previous => [entry, ...previous].slice(0, 50));
    } catch (error) {
      if (sessionEpoch.current !== epoch) return;
      notify('error', (error as Error).message);
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) { sessionEpoch.current += 1; await request('/auth/logout', { method: 'POST' }).catch(() => {}); setUser(null); setHistory([]); setSaved([]); resetAssessment(); }
    } finally { setBusy(false); }
  };
  const importFile = async (file: File) => {
    if (!schema) return;
    const epoch = sessionEpoch.current;
    if (file.size > 100_000) { notify('error', 'Choose a JSON file smaller than 100 KB.'); return; }
    try {
      const imported = parseImport(await file.text(), schema);
      if (sessionEpoch.current !== epoch) return;
      setValues(imported.values); setSampleId(imported.sample_id); setErrors({}); setValidated(false); setPrediction(null); setModelPending(false); setIsExample(false);
      notify('success', 'Measurements imported. Validate the inputs to continue.');
    } catch (error) { notify('error', (error as Error).message); }
  };
  const filteredResources = resources.filter(resource => {
    const query = search.toLowerCase().trim();
    return (!query || `${resource.title} ${resource.summary} ${resource.tags.join(' ')}`.toLowerCase().includes(query)) && (filter !== 'Saved' || saved.includes(resource.id));
  });

  const libraryCards = (list: Resource[]) => <div className="resource-grid">{list.map(resource => <ResourceCard key={resource.id} resource={resource} onOpen={() => setArticle(resource)} saved={saved.includes(resource.id)} onSave={() => toggleSaved(resource.id)} />)}</div>;
  const libraryFeedback = () => libraryLoading ? <div className="empty-state compact"><LoaderCircle className="spin" size={24} /><p>Opening your learning library…</p></div> : libraryError ? <div className="empty-state compact"><BookOpen size={28} /><h3>The library is temporarily unavailable</h3><p>{libraryError}</p><button className="button secondary" onClick={() => { void connect(); setUser(previous => previous ? { ...previous } : null); setLibraryLoading(true); void request<{ resources: Resource[] }>('/library').then(data => { setResources(data.resources); setLibraryError(''); }).catch(error => setLibraryError(error.message)).finally(() => setLibraryLoading(false)); }}><RefreshCw size={15} /> Try again</button></div> : null;

  return <div className="app-shell">
    {mobileNav && <button className="nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <button className="brand" onClick={() => navigate('overview')} aria-label="Breast Cancer Prediction home"><span className="brand-mark"><HeartHandshake size={27} strokeWidth={1.5} /></span><span>Breast Cancer<small>PREDICTION & EDUCATION</small></span></button>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav aria-label="Main navigation">
        {([{ id: 'overview', icon: LayoutDashboard }, { id: 'library', icon: BookOpen }, { id: 'assessment', icon: ClipboardList }, { id: 'history', icon: History }] as { id: Page; icon: LucideIcon }[]).map(item => {
          const locked = (item.id === 'assessment' || item.id === 'history') && !accessible;
          return <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''} ${locked ? 'locked' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => locked ? user ? notify('info', user.role === 'patient' ? 'Your patient workspace focuses on learning. Assessment tools are available to students and approved professionals.' : 'Your professional account is awaiting approval. You can explore public learning resources now.') : openAuth('login') : navigate(item.id)}><item.icon size={19} strokeWidth={1.7} /><span>{pageNames[item.id]}</span>{locked && <LockKeyhole size={13} />}</button>;
        })}
      </nav>
      <div className="sidebar-note"><span className="small-flower"><Leaf size={21} /></span><h4>Knowledge brings clarity.</h4><p>Take your next step with information you can trust.</p><button className="text-button" onClick={() => navigate('library')}>Explore the library <ArrowRight size={14} /></button></div>
      <div className="sidebar-bottom"><button className={`nav-item ${page === 'about' ? 'active' : ''}`} onClick={() => navigate('about')}><CircleHelp size={18} /> About the project</button><div className="sidebar-caption"><ShieldCheck size={14} /> Education & research workspace</div><small>Thoughtfully built. Thoughtfully used.</small></div>
    </aside>

    <div className="main-shell">
      <header className="topbar">
        <div className="breadcrumb"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation"><Menu size={22} /></button><span>Workspace</span><ChevronRight size={13} /><strong>{pageNames[page]}</strong></div>
        <div className="topbar-actions"><button className={`connection-badge ${health ? 'connected' : 'offline'}`} onClick={() => void connect()} title="Refresh API connection" disabled={connecting}><span className={connecting ? 'status-dot checking' : 'status-dot'} />{connecting ? 'Connecting' : health ? 'API connected' : 'API offline'}</button>
          {user ? <><span className="profile-avatar">{user.username.slice(0, 1).toUpperCase()}</span><div className="profile-text"><strong>{user.username}</strong><small>{formatRole(user.role)}{!user.approved && ' · Pending'}</small></div><button className="icon-button" onClick={() => void handleLogout()} disabled={busy || authBusy || !identityReady} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button></> : <button className="button signin-button" disabled={!identityReady || authBusy} onClick={() => openAuth('login')}>Sign in <ArrowRight size={15} /></button>}
        </div>
      </header>

      <main className="page-content" id="main-content">
        {notice && <div className={`notice ${notice.kind}`} role="status"><span>{notice.kind === 'success' ? <CheckCheck size={18} /> : <CircleHelp size={18} />}{notice.text}</span><button className="icon-button" onClick={() => setNotice(null)} aria-label="Dismiss notification"><X size={17} /></button></div>}
        {user && !user.approved && <div className="approval-banner"><LockKeyhole size={18} /><p><strong>Your professional account is awaiting approval.</strong> Explore public resources while the workspace administrator verifies your access.</p></div>}

        {page === 'overview' && <>
          <div className="page-heading"><div><p className="eyebrow rose-text">A SPACE FOR KNOWLEDGE & CARE</p><h1>{user ? `Welcome back, ${user.username}.` : 'A little knowledge. A brighter outlook.'}</h1><p>Where breast health education meets thoughtful exploration.</p></div><span className="subtle-label"><Leaf size={15} /> Made for every perspective</span></div>
          <section className="hero-panel"><div className="hero-copy"><span className="hero-kicker"><span /> UNDERSTAND. EXPLORE. MOVE FORWARD.</span><h2>Clarity starts with<br /><em>understanding.</em></h2><p>Reliable resources, a space to learn, and tools to support your next step. Wherever you are in your journey, there’s a place for you here.</p><div className="hero-actions"><button className="button primary" onClick={() => navigate('library')}>Explore your learning library <ArrowRight size={17} /></button><button className="text-button" onClick={() => navigate('about')}>About the project <ArrowUpRight size={15} /></button></div><div className="hero-footnote"><ShieldCheck size={15} /> Curated from trusted medical and research sources</div></div><BotanicalArt /><span className="art-caption">SMALL STEPS. MEANINGFUL UNDERSTANDING.</span></section>
          <div className="overview-stats"><div><span className="stat-icon rose"><Users size={20} /></span><p><strong>4 perspectives</strong><small>One connected learning space</small></p></div><div><span className="stat-icon sage"><BookOpen size={20} /></span><p><strong>Source-linked learning</strong><small>Read, reflect, and explore further</small></p></div><div><span className="stat-icon lavender"><ShieldCheck size={20} /></span><p><strong>Role-aware access</strong><small>The right tools for your workspace</small></p></div></div>
          <section><div className="section-heading"><div><p className="eyebrow">YOUR JOURNEY, YOUR PERSPECTIVE</p><h2>A workspace that meets you where you are.</h2></div><span className="subtle-label">Find your starting point</span></div><div className="role-grid">{roles.map(role => <article className={`role-card ${role.color} ${user?.role === role.id ? 'selected-role' : ''}`} key={role.id}><div className="role-card-top"><span className="role-icon"><role.icon size={23} strokeWidth={1.6} /></span>{user?.role === role.id && <span className="role-current"><Check size={12} /> Your space</span>}</div><h3>{role.label}</h3><p>{role.description}</p><button className="text-button role-link" onClick={() => user?.role === role.id ? navigate('library') : user ? notify('info', 'Your account role determines access. Sign out to register a separate account for a different role.') : openAuth('register', role.id)}>{role.tag}<ArrowRight size={15} /></button></article>)}</div></section>
          <section><div className="section-heading"><div><p className="eyebrow">A GOOD PLACE TO BEGIN</p><h2>{activeRole && user?.approved ? `Selected for ${activeRole.label.toLowerCase()}` : 'Read a little. Understand a little more.'}</h2></div><button className="text-button view-all" onClick={() => navigate('library')}>View the library <ArrowRight size={16} /></button></div>{libraryFeedback() || libraryCards(resources.slice(0, 3))}</section>
          <div className="care-note"><Heart size={20} /><p><strong>A gentle reminder</strong> This workspace supports learning and research. It does not provide a diagnosis or replace conversations with a qualified healthcare professional.</p><span>KNOWLEDGE WITH CARE</span></div>
        </>}

        {page === 'library' && <>
          <div className="page-heading"><div><p className="eyebrow rose-text">MAKE ROOM FOR UNDERSTANDING</p><h1>Your learning library</h1><p>Clear explanations, thoughtful reading, and sources you can explore.</p></div><span className="pill"><BookOpen size={15} /> {user?.approved ? formatRole(user.role) : 'Public'} collection</span></div>
          <div className="library-banner"><div><BookOpen size={29} strokeWidth={1.4} /><div><h3>Good questions deserve reliable answers.</h3><p>Every article includes a link to its original medical or research source.</p></div></div><span>CURATED WITH PURPOSE</span></div>
          <div className="library-toolbar"><div className="filter-tabs" aria-label="Library filters">{['All resources', 'Saved'].map(tab => <button key={tab} className={filter === tab ? 'selected' : ''} onClick={() => setFilter(tab)}>{tab}{tab === 'Saved' && <span>{saved.length}</span>}</button>)}</div><label className="search-field"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search topics, questions, keywords…" aria-label="Search learning resources" />{search && <button className="icon-button" onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}</label></div>
          {!libraryLoading && !libraryError && <p className="results-count">{filteredResources.length} {filteredResources.length === 1 ? 'resource' : 'resources'} {search ? `matching “${search}”` : 'to explore'} <span>Saved articles stay in this browser session.</span></p>}
          {libraryFeedback() || (filteredResources.length ? libraryCards(filteredResources) : <div className="empty-state"><Search size={30} /><h3>{filter === 'Saved' ? 'Your reading list starts here.' : 'No resources found.'}</h3><p>{filter === 'Saved' ? 'Tap the plus on an article to keep it close during this session.' : 'Try a different topic or a shorter search.'}</p><button className="button secondary" onClick={() => { setFilter('All resources'); setSearch(''); }}>Browse all resources <ArrowRight size={15} /></button></div>)}
          {!user && <div className="library-signup"><div><GraduationCap size={26} /><p><strong>Make the library yours.</strong><span>Create an account for resources tailored to your role.</span></p></div><button className="button primary" onClick={() => openAuth('register')}>Find your workspace <ArrowRight size={16} /></button></div>}
        </>}

        {page === 'assessment' && accessible && <>
          <div className="page-heading"><div><p className="eyebrow rose-text">{user?.role === 'student' ? 'LEARN BY EXPLORING' : 'STRUCTURED INPUTS. CLEAR NEXT STEPS.'}</p><h1>{user?.role === 'student' ? 'Measurement practice' : 'Assessment room'}</h1><p>{user?.role === 'student' ? 'Explore the input structure and validate a practice case.' : 'Prepare and validate measurements for your assessment workflow.'}</p></div><span className="pill"><LockKeyhole size={14} /> {formatRole(user!.role)} workspace</span></div>
          {!schema ? <div className="empty-state"><RefreshCw size={28} /><h3>Connect the API to open the workspace.</h3><p>The input form uses the feature definitions provided by your backend.</p><button className="button primary" onClick={() => void connect()}>Check connection</button></div> : <>
            <div className="assessment-steps"><span className="step active"><b>1</b> Enter measurements</span><i /><span className={`step ${validated ? 'active' : ''}`}><b>{validated ? <Check size={14} /> : '2'}</b> Validate inputs</span><i /><span className={`step ${prediction ? 'active' : ''}`}><b>3</b> {user?.role === 'student' ? 'Export & explore' : 'Review assessment'}</span></div>
            <div className="assessment-grid"><section className="measurement-panel"><div className="panel-heading"><div><h2>Cell measurements</h2><p>Complete all {schema.feature_order.length} measurements across the three groups.</p></div><button className="text-button" onClick={loadExample} disabled={busy}><Sparkles size={15} /> Use example</button></div>
              <label className="case-field">Case reference <span>Optional · avoid personal identifiers</span><input type="text" maxLength={80} value={sampleId} onChange={event => { setSampleId(event.target.value); setValidated(false); setPrediction(null); setModelPending(false); }} placeholder="e.g. CASE-001" disabled={busy} /></label>
              <div className="measurement-tabs" role="tablist" aria-label="Measurement groups">{schema.groups.map((item, index) => <button role="tab" id={`tab-${item.id}`} aria-controls={`panel-${item.id}`} aria-selected={group === item.id} key={item.id} className={group === item.id ? 'selected' : ''} onClick={() => setGroup(item.id)}><span>0{index + 1}</span>{item.id === 'mean' ? 'Mean' : item.id === 'se' ? 'Standard error' : 'Worst'}<small>{schema.features.filter(field => field.group === item.id && values[field.name]?.trim()).length}/{schema.features.filter(field => field.group === item.id).length}</small></button>)}</div>
              <div className="group-intro"><h3>{schema.groups.find(item => item.id === group)?.label}</h3><p>{schema.groups.find(item => item.id === group)?.description}</p></div>
              <div className="measurement-fields" role="tabpanel" id={`panel-${group}`} aria-labelledby={`tab-${group}`}>{schema.features.filter(field => field.group === group).map(field => <label key={field.name} className={`measurement-field ${errors[field.name] ? 'invalid' : ''}`} htmlFor={field.name}><span>{field.label}<small title={field.description}><CircleHelp size={12} /></small></span><input id={field.name} type="number" min={field.minimum} step="any" value={values[field.name] || ''} placeholder="0.000" disabled={busy} aria-invalid={!!errors[field.name]} aria-describedby={`${field.name}-help`} onChange={event => { setValues(previous => ({ ...previous, [field.name]: event.target.value })); setErrors(previous => { const next = { ...previous }; delete next[field.name]; return next; }); setValidated(false); setModelPending(false); setPrediction(null); setIsExample(false); }} /><small id={`${field.name}-help`}>{errors[field.name] || field.name}</small></label>)}</div>
              <div className="measurements-footer"><span><ShieldCheck size={14} /> Finite, non-negative numbers only</span><div><button className="text-button" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={15} /> Import JSON</button><button className="text-button" onClick={() => { resetAssessment(); setNotice(null); }} disabled={busy}><RefreshCw size={14} /> Reset</button></div><input ref={fileRef} className="visually-hidden" type="file" accept=".json,application/json" aria-label="Import measurements from JSON" onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ''; }} /></div>
            </section>
            <aside className="assessment-summary"><section className="summary-card"><div className="summary-title"><h3>Assessment overview</h3><ClipboardList size={18} /></div><div className="completion-ring" style={{ '--progress': `${filled / schema.feature_order.length * 360}deg` } as CSSProperties}><div><strong>{filled}<span>/{schema.feature_order.length}</span></strong><small>inputs complete</small></div></div><div className="summary-groups">{schema.groups.map(item => { const fields = schema.features.filter(field => field.group === item.id); const count = fields.filter(field => values[field.name]?.trim() && !validateValues({ [field.name]: values[field.name] }, { ...schema, features: [field] })[field.name]).length; return <div key={item.id}><span><span className={`mini-dot ${count === fields.length ? 'complete' : ''}`} />{item.label}</span><strong>{count} / {fields.length}</strong></div>; })}</div><div className="summary-divider" /><div className={`model-status ${validated ? 'input-ready' : ''}`}><span>{validated ? <CheckCheck size={19} /> : <LockKeyhole size={19} />}</span><div><strong>{prediction ? 'Assessment returned' : modelPending ? 'Awaiting model integration' : validated ? 'Inputs validated' : 'Ready when you are'}</strong><p>{prediction ? 'Review the response below.' : 'Prediction results require your connected model.'}</p></div></div>{prediction && <div className="prediction-result"><span>Prediction response</span><strong>{prediction.prediction}</strong>{prediction.probability !== null && <p>Returned probability: {(prediction.probability * 100).toFixed(1)}%</p>}<small>Interpret with the model’s intended use and validation evidence.</small></div>}
              <button className="button primary full-width" disabled={busy || authBusy || !health} onClick={() => void submitAssessment(predictionAllowed)}>{busy ? <LoaderCircle size={17} className="spin" /> : <ShieldCheck size={17} />}{busy ? 'Checking inputs…' : predictionAllowed ? 'Request assessment' : 'Validate measurements'}{!busy && <ArrowRight size={16} />}</button>
              <button className="button secondary full-width" disabled={busy || filled !== schema.feature_order.length} onClick={() => { if (checkInputs()) downloadJson(currentPayload()); }}><ArrowDownToLine size={15} /> Export inputs</button>
              {isExample && <p className="example-label">Synthetic example · no diagnostic meaning</p>}{user?.role === 'student' && <p className="student-note">Your student account can validate and export practice inputs. Prediction access is reserved for approved professionals.</p>}
            </section><section className="privacy-card"><ShieldCheck size={20} /><h4>Thoughtful about your data.</h4><p>Measurements stay in this session. The API validates them without storing them. Use a reference code instead of a person’s name.</p></section></aside></div>
          </>}
        </>}

        {page === 'history' && accessible && <>
          <div className="page-heading"><div><p className="eyebrow rose-text">YOUR WORK, IN ONE PLACE</p><h1>Session history</h1><p>Revisit input validations from your current browser session.</p></div>{history.length > 0 && <button className="button secondary" onClick={() => setHistory([])}><Trash2 size={15} /> Clear session</button>}</div>
          <div className="session-note"><ShieldCheck size={17} /> History is kept in memory and cleared when you refresh or sign out. Up to 50 recent entries are shown.</div>
          {history.length ? <div className="history-table-wrap"><table className="history-table"><thead><tr><th>Case reference</th><th>Time</th><th>Measurements</th><th>Status</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{history.map(entry => <tr key={entry.id}><td><span className="case-icon"><FileJson size={18} /></span><strong>{entry.payload.sample_id || 'Unnamed case'}</strong></td><td>{new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td>{Object.keys(entry.payload.features).length} inputs</td><td><span className={`history-status ${entry.status === 'Validated' ? 'valid' : ''}`}>{entry.status}</span></td><td><div className="history-actions"><button className="text-button" onClick={() => { setValues(Object.fromEntries(Object.entries(entry.payload.features).map(([name, value]) => [name, String(value)]))); setSampleId(entry.payload.sample_id || ''); setValidated(false); setModelPending(false); setPrediction(null); setErrors({}); setIsExample(false); navigate('assessment'); }}>Reopen <ArrowUpRight size={14} /></button><button className="icon-button" onClick={() => downloadJson(entry.payload)} aria-label={`Export ${entry.payload.sample_id || 'case'}`}><ArrowDownToLine size={16} /></button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><History size={32} /><h3>A fresh start.</h3><p>Your validated cases will appear here as you use the assessment workspace.</p><button className="button primary" onClick={() => navigate('assessment')}>Start an assessment <ArrowRight size={16} /></button></div>}
        </>}

        {page === 'about' && <>
          <div className="page-heading"><div><p className="eyebrow rose-text">KNOWLEDGE WITH PURPOSE</p><h1>A thoughtful space for breast health.</h1><p>Built around the people learning, researching, and caring.</p></div><span className="brand-mark"><HeartHandshake size={30} strokeWidth={1.5} /></span></div>
          <section className="about-intro"><h2>Different perspectives.<br /><em>A shared need for clarity.</em></h2><p>This project brings reliable breast health reading and structured measurement tools into one calm workspace. Patients can learn at their own pace. Students can explore the foundations. Researchers and doctors can prepare inputs for an assessment workflow.</p><p>This version supports education, account access, and input validation. A prediction model has not been added; assessment results remain unavailable until it is integrated.</p></section>
          <div className="section-heading"><div><p className="eyebrow">ACCESS THAT MAKES SENSE</p><h2>What each workspace includes</h2></div></div>
          <div className="permissions-table-wrap"><table className="permissions-table"><thead><tr><th>Workspace</th><th>Learning library</th><th>Input validation</th><th>Prediction access</th></tr></thead><tbody>{roles.map(role => <tr key={role.id}><td><role.icon size={18} /><strong>{role.label}</strong></td><td>Role-specific resources</td><td>{role.id === 'patient' ? '—' : role.id === 'student' ? 'Practice workspace' : 'After account approval'}</td><td>{role.id === 'patient' || role.id === 'student' ? '—' : 'After approval & model integration'}</td></tr>)}</tbody></table></div>
          <div className="about-cards"><article><ShieldCheck size={25} /><h3>Real access controls</h3><p>Account permissions are checked by the API. Professional accounts require administrator approval before restricted tools open.</p></article><article><BookOpen size={25} /><h3>Sources beside the learning</h3><p>Each resource links to the original source, including NCI, WHO, UCI, and published research. Read further and bring questions to your care or research team.</p></article><article><Heart size={25} /><h3>Clear about its limits</h3><p>Educational information and future assessment responses are not a clinical diagnosis. Clinical decisions need qualified professionals and validated evidence.</p></article></div>
          <div className="care-note"><Leaf size={21} /><p><strong>Designed to grow with your work.</strong> The assessment schema comes from the API so your future model’s required measurements can be configured in one place.</p></div>
        </>}
        <footer className="page-footer"><span>© {new Date().getFullYear()} Breast Cancer Prediction.</span><div><ShieldCheck size={13} /> Educational use · no model connected</div></footer>
      </main>
    </div>

    {authMode && <Modal title={authMode === 'login' ? 'Welcome to your workspace' : 'Create your workspace'} close={closeAuth}>
      <p className="modal-description">{authMode === 'login' ? 'Sign in to continue learning and exploring.' : 'Choose your role and create a personal learning workspace.'}</p>
      <form className="auth-form" onSubmit={event => void handleAuth(event)}>
        {authMode === 'register' && <fieldset className="auth-role-picker"><legend>I’m here as a…</legend><div>{roles.map(role => <button type="button" key={role.id} className={authRole === role.id ? 'selected' : ''} onClick={() => setAuthRole(role.id)} disabled={authBusy} aria-pressed={authRole === role.id}><role.icon size={18} /><span>{formatRole(role.id)}</span>{authRole === role.id && <Check size={14} />}</button>)}</div></fieldset>}
        {authMode === 'register' && (authRole === 'doctor' || authRole === 'researcher') && <div className="auth-approval-note"><LockKeyhole size={17} /><p>Professional tools require approval by the workspace administrator. Public learning resources are available while you wait.</p></div>}
        <label>Username<input name="username" required minLength={3} maxLength={40} pattern={"[A-Za-z0-9_.\\-]+"} autoComplete="username" placeholder="Choose a username" disabled={authBusy} /><small>3–40 letters, numbers, periods, underscores, or hyphens.</small></label>
        <label>Password<input name="password" type="password" required minLength={authMode === 'register' ? 12 : 1} maxLength={128} autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} placeholder={authMode === 'register' ? 'At least 12 characters' : 'Enter your password'} disabled={authBusy} />{authMode === 'register' && <small>Use a unique password with at least 12 characters.</small>}</label>
        {authError && <div className="inline-error" role="alert">{authError}</div>}
        <button className="button primary full-width" disabled={authBusy}>{authBusy ? <LoaderCircle size={17} className="spin" /> : null}{authBusy ? 'Opening your workspace…' : authMode === 'login' ? 'Sign in' : 'Create my workspace'}<ArrowRight size={17} /></button>
      </form>
      <p className="auth-switch">{authMode === 'login' ? 'New here?' : 'Already have a workspace?'} <button className="text-button" disabled={authBusy} onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}>{authMode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
      <div className="auth-privacy"><ShieldCheck size={14} /> Please don’t use a patient’s name as your username.</div>
    </Modal>}
    {article && <Modal title={article.title} close={closeArticle} wide>
      <div className="article-meta"><span className="pill">{article.category}</span><span><Clock3 size={14} /> {article.reading_minutes} min read</span></div><p className="article-summary">{article.summary}</p><div className="article-body">{article.body.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div><div className="article-source"><ShieldCheck size={20} /><div><span>READ THE ORIGINAL SOURCE</span><a href={article.source.url} target="_blank" rel="noopener noreferrer">{article.source.label}<ArrowUpRight size={16} /></a></div></div><div className="article-bottom"><p>For learning and discussion. This article does not provide personal medical advice.</p><button className="button secondary" onClick={() => toggleSaved(article.id)}>{saved.includes(article.id) ? <Check size={16} /> : <Plus size={16} />}{saved.includes(article.id) ? 'Saved to your reading list' : 'Save for this session'}</button></div>
    </Modal>}
  </div>;
}
