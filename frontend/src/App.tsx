import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { ArrowDownToLine, ArrowRight, ArrowUpRight, BookOpen, Check, CheckCheck, ChevronRight, CircleHelp, ClipboardList, Clock3, FileJson, FlaskConical, GraduationCap, Heart, HeartHandshake, History, LayoutDashboard, Leaf, LoaderCircle, LockKeyhole, LogOut, Menu, Plus, RefreshCw, Search, ShieldCheck, Sparkles, Stethoscope, Trash2, Upload, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ApiError, canAssess, canPredict, downloadJson, parseImport, request, validateValues } from './api';
import type { FeatureSchema, Health, Payload, Prediction, Resource, Role, User, Validation } from './api';
import SiteFooter from './SiteFooter';
import PredictionCalculator from './PredictionCalculator';
import { DatasetUploadPage, ShapExplorerPage } from './ModelTools';
import AuthFields from './AuthFields';
import { AboutPage, ModelPage, useAboutAlert } from './AboutPages';
import publicResources from './publicResources.json';

type Page = 'overview' | 'prediction' | 'library' | 'assessment' | 'history' | 'about' | 'model' | 'dataset' | 'shap';
type Notice = { kind: 'success' | 'error' | 'info'; text: string };
type SessionEntry = { id: string; time: string; payload: Payload; status: 'Validated' | 'Awaiting model' | 'Completed'; prediction?: Prediction };
const roles: { id: Role; label: string; description: string; icon: LucideIcon; tag: string; color: string }[] = [
  { id: 'patient', label: 'Patients', description: 'Understand breast health, find reliable answers, and prepare for conversations with your care team.', icon: Heart, tag: 'Understand & feel informed', color: 'rose' },
  { id: 'student', label: 'Students', description: 'Build your foundations with guided reading and a hands-on measurement practice workspace.', icon: GraduationCap, tag: 'Learn & put it into practice', color: 'lavender' },
  { id: 'researcher', label: 'Researchers', description: 'Explore study design, data quality, and a structured workspace for future assessment tools.', icon: FlaskConical, tag: 'Explore & investigate', color: 'sage' },
  { id: 'doctor', label: 'Doctors', description: 'Review clinical resources and prepare measurement inputs in a focused professional workspace.', icon: Stethoscope, tag: 'Review & assess', color: 'sand' },
];
const pageNames: Record<Page, string> = { overview: 'Overview', prediction: 'Prediction calculator', library: 'Learning library', assessment: 'Assessment room', history: 'Session history', about: 'About the project', model: 'About the model', dataset: 'Dataset upload', shap: 'SHAP Explorer' };
function pageFromHash(): Page | undefined {
  const hash = window.location.hash.slice(1);
  return Object.hasOwn(pageNames, hash) ? hash as Page : undefined;
}
const formatRole = (role: Role) => role === 'doctor' ? 'Doctor' : role[0].toUpperCase() + role.slice(1);

function ResearchVisual() {
  return <div className="research-visual" aria-label="Illustration of the measurement workflow">
    <div className="visual-label"><span className="visual-dot" /> A CLOSER LOOK</div>
    <svg className="cell-art" viewBox="0 0 420 320" fill="none" aria-hidden="true">
      <circle cx="210" cy="155" r="129" stroke="currentColor" opacity=".18" /><circle cx="210" cy="155" r="100" stroke="currentColor" opacity=".13" strokeDasharray="3 8" />
      <path d="M73 155h42m190 0h42M210 18v39m0 195v39" stroke="currentColor" opacity=".35" />
      <path d="M148 88c31-28 65-8 67 19 2 23-14 55-42 55-29 0-44-47-25-74Z" fill="#d8e8cf" fillOpacity=".85" /><ellipse cx="174" cy="120" rx="14" ry="18" fill="#365d50" />
      <path d="M243 100c32-7 57 14 52 43-5 25-34 41-54 23-23-20-27-60 2-66Z" fill="#abc6ae" /><ellipse cx="264" cy="134" rx="13" ry="17" transform="rotate(30 264 134)" fill="#365d50" />
      <path d="M182 180c25-24 57-8 58 16 1 30-14 53-39 48-26-5-37-45-19-64Z" fill="#d9b1ad" /><ellipse cx="209" cy="208" rx="14" ry="17" fill="#885e62" />
      <path d="m285 99 39-32h53M157 221l-33 35H56" stroke="#c3d8c4" opacity=".6" /><circle cx="285" cy="99" r="4" fill="#c3d8c4" /><circle cx="157" cy="221" r="4" fill="#d9b1ad" />
    </svg>
    <div className="visual-caption"><span>Cell measurement study</span><small>Illustration · not diagnostic imagery</small></div>
    <div className="visual-data"><div><strong>30</strong><span>measurements</span></div><div><strong>03</strong><span>feature groups</span></div><div><FlaskConical size={25} /><span>Research workspace</span></div></div>
  </div>;
}

function Modal({ title, children, close, wide = false, className = '' }: { title: string; children: ReactNode; close: () => void; wide?: boolean; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => (ref.current?.querySelector<HTMLElement>('input:not(:disabled)') || ref.current)?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      if (event.key !== 'Tab') return;
      const elements = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') || []).filter(item => item.offsetParent !== null);
      if (!elements?.length) return;
      const first = elements[0]; const last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { window.cancelAnimationFrame(frame); document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', onKey); if (previous?.isConnected) previous.focus(); };
  }, []);
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) close(); }}>
    <div className={`modal ${wide ? 'modal-wide' : ''} ${className}`} role="dialog" aria-modal="true" aria-labelledby="modal-title" tabIndex={-1} ref={ref}>
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
  useAboutAlert();
  const [page, setPage] = useState<Page>(() => pageFromHash() ?? 'overview');
  const [mobileNav, setMobileNav] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const previousPage = useRef<Page>('overview');
  const sessionEpoch = useRef(0);
  const [identityReady, setIdentityReady] = useState(false);
  const [health, setHealth] = useState<Health | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [schema, setSchema] = useState<FeatureSchema | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [resources, setResources] = useState<Resource[]>(publicResources);
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
    setLibraryLoading(true); setLibraryError(''); setArticle(null); setResources(publicResources);
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
  }, [user, identityReady, libraryRefresh]);
  useEffect(() => {
    const syncPage = () => {
      const next = pageFromHash();
      if (next || !window.location.hash) { setPage(next ?? 'overview'); setMobileNav(false); }
    };
    window.addEventListener('hashchange', syncPage);
    return () => window.removeEventListener('hashchange', syncPage);
  }, []);
  useEffect(() => {
    if (identityReady && !accessible && (page === 'assessment' || page === 'history')) {
      window.history.replaceState(null, '', '#overview');
      setPage('overview');
    }
  }, [accessible, page, identityReady]);
  useEffect(() => {
    setNotice(null);
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (previousPage.current !== page) window.requestAnimationFrame(() => mainRef.current?.focus());
    previousPage.current = page;
  }, [page]);
  useEffect(() => {
    if (!mobileNav) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    navRef.current?.querySelector<HTMLButtonElement>('.nav-close')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileNav(false);
      if (event.key !== 'Tab') return;
      const items = Array.from(navRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]') || []).filter(item => item.offsetParent !== null);
      if (!items.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    };
    const desktop = window.matchMedia('(min-width: 1025px)');
    const onResize = () => { if (desktop.matches) setMobileNav(false); };
    desktop.addEventListener('change', onResize);
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
      desktop.removeEventListener('change', onResize);
      if (previous?.isConnected) previous.focus();
    };
  }, [mobileNav]);

  const closeAuth = useCallback(() => { if (!authBusy) { setAuthMode(null); setAuthError(''); } }, [authBusy]);
  const closeArticle = useCallback(() => setArticle(null), []);
  const closePrivacy = useCallback(() => setPrivacyOpen(false), []);
  const openAuth = (mode: 'login' | 'register', role: Role = 'patient') => { setMobileNav(false); setAuthRole(role); setAuthError(''); setAuthMode(mode); };
  const navigate = (next: Page) => {
    if (window.location.hash !== '#' + next) window.location.hash = next;
    setPage(next); setMobileNav(false);
  };
  const notify = (kind: Notice['kind'], text: string) => setNotice({ kind, text });
  const toggleSaved = (id: string) => setSaved(previous => previous.includes(id) ? previous.filter(item => item !== id) : [...previous, id]);
  const resetAssessment = () => { setValues({}); setErrors({}); setSampleId(''); setValidated(false); setModelPending(false); setPrediction(null); setIsExample(false); setGroup('mean'); };
  const handleLogout = async () => {
    sessionEpoch.current += 1;
    setAuthBusy(true);
    try {
      await request('/auth/logout', { method: 'POST' });
      setUser(null); navigate('overview');
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
    if (authMode === 'register' && credentials.password !== String(data.get('confirm_password'))) {
      setAuthError('Your passwords do not match. Enter the same password in both fields.');
      document.getElementById('auth-confirm')?.focus();
      return;
    }
    sessionEpoch.current += 1;
    let registered = false;
    setAuthBusy(true); setAuthError('');
    try {
      if (authMode === 'register') { await request('/auth/register', { method: 'POST', body: JSON.stringify({ ...credentials, role: authRole }) }); registered = true; }
      const result = await request<{ user: User }>('/auth/login', { method: 'POST', body: JSON.stringify(credentials) });
      setUser(result.user); setHistory([]); setSaved([]); resetAssessment(); setAuthMode(null); navigate(page === 'model' ? 'model' : 'overview');
      notify('success', result.user.approved ? `Welcome, ${result.user.username}. Your workspace is ready.` : 'Account created. Professional tools will become available after account approval.');
    } catch (error) {
      if (registered) { setAuthMode('login'); setAuthError('Your account was created. Please sign in to continue. ' + (error as Error).message); }
      else setAuthError((error as Error).message);
    }
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
    if (first) { setGroup(schema.features.find(field => field.name === first)?.group || 'mean'); notify('error', 'Complete the highlighted measurements before continuing.'); window.requestAnimationFrame(() => document.getElementById(first)?.focus()); return false; }
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
  const libraryFeedback = () => !resources.length && libraryLoading ? <div className="empty-state compact"><LoaderCircle className="spin" size={24} /><p>Opening your learning library…</p></div> : !resources.length && libraryError ? <div className="empty-state compact"><BookOpen size={28} /><h3>The library is temporarily unavailable</h3><p>{libraryError}</p><button className="button secondary" onClick={() => setLibraryRefresh(value => value + 1)}><RefreshCw size={16} /> Try again</button></div> : null;

  return <div className={`app-shell ${!user ? 'public-shell' : ''}`}>
    <a className="skip-link" href="#main-content">Skip to main content</a>
    {mobileNav && <button tabIndex={-1} className="nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside id="workspace-navigation" ref={navRef} className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`} role={mobileNav ? 'dialog' : undefined} aria-modal={mobileNav ? true : undefined} aria-label="Workspace navigation"><button className="icon-button nav-close" onClick={() => setMobileNav(false)} aria-label="Close navigation"><X size={22} /></button>
      <button className="brand" onClick={() => navigate('overview')} aria-label="Breast Cancer Prediction home"><span className="brand-mark"><HeartHandshake size={27} strokeWidth={1.5} /></span><span>Breast Cancer<small>PREDICTION & EDUCATION</small></span></button>
      <div className="workspace-label">YOUR WORKSPACE</div>
      <nav aria-label="Main navigation">
        {([{ id: 'overview', icon: LayoutDashboard }, { id: 'prediction', icon: FlaskConical }, { id: 'library', icon: BookOpen }, { id: 'assessment', icon: ClipboardList }, { id: 'history', icon: History }] as { id: Page; icon: LucideIcon }[]).map(item => {
          if (item.id === 'prediction') return <a key={item.id} href="#prediction" className={'nav-item calc-link' + (page === 'prediction' ? ' active' : '')} aria-current={page === 'prediction' ? 'page' : undefined} onClick={() => setMobileNav(false)}><FlaskConical size={19} strokeWidth={1.7} /><span>Prediction calculator</span></a>;
          const locked = (item.id === 'assessment' || item.id === 'history') && !accessible;
          return <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''} ${locked ? 'locked' : ''}`} aria-current={page === item.id ? 'page' : undefined} onClick={() => locked ? user ? notify('info', user.role === 'patient' ? 'Your patient workspace focuses on learning. Assessment tools are available to students and approved professionals.' : 'Your professional account is awaiting approval. You can explore public learning resources now.') : openAuth('login') : navigate(item.id)}><item.icon size={19} strokeWidth={1.7} /><span>{pageNames[item.id]}</span>{locked && <LockKeyhole size={13} />}</button>;
        })}
      </nav>
      <div className="sidebar-note"><span className="small-flower"><Leaf size={21} /></span><h4>Start with a good source.</h4><p>Every article links to the original medical or research publication.</p><button className="text-button" onClick={() => navigate('library')}>Explore the library <ArrowRight size={14} /></button></div>
      <div className="sidebar-bottom">{user?.approved && (user.role === 'student' || user.role === 'researcher') && <button className={`nav-item ${page === 'model' ? 'active' : ''}`} onClick={() => navigate('model')}><FlaskConical size={18} /> About the model</button>}<button className={`nav-item ${page === 'about' ? 'active' : ''}`} onClick={() => navigate('about')}><CircleHelp size={18} /> About the project</button><div className="sidebar-caption"><ShieldCheck size={14} /> Education & research workspace</div><small>Breast health. In context.</small></div>
    </aside>

    <div className="main-shell" inert={mobileNav || undefined}>
      <header className="topbar">
        {!user && <button className="brand header-brand" onClick={() => navigate('overview')} aria-label="Breast Cancer Prediction home"><span className="brand-mark"><HeartHandshake size={27} strokeWidth={1.6} /></span><span>Breast Cancer<small>PREDICTION & EDUCATION</small></span></button>}
        <nav className="public-navigation" aria-label="Main navigation">{(['overview', 'prediction', 'dataset', 'shap', 'library', 'about'] as const).map(item => item === 'prediction' ? <a key={item} href="#prediction" aria-current={page === item ? 'page' : undefined}>Prediction calculator</a> : <button key={item} onClick={() => (item === 'dataset' || item === 'shap') && !user ? openAuth('login', 'student') : navigate(item)} aria-current={page === item ? 'page' : undefined}>{item === 'overview' ? 'Home' : item === 'library' ? 'Learning library' : item === 'dataset' ? 'Dataset upload' : item === 'shap' ? 'SHAP Explorer' : 'About'}</button>)}</nav>
        <div className="breadcrumb"><button className="icon-button mobile-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation" aria-expanded={mobileNav} aria-controls="workspace-navigation"><Menu size={22} /></button><span>Workspace</span><ChevronRight size={13} /><strong>{pageNames[page]}</strong></div>
        <div className="topbar-actions"><button className={`connection-badge ${health ? 'connected' : 'offline'}`} onClick={() => void connect()} title="Refresh API connection" disabled={connecting}><span className={connecting ? 'status-dot checking' : 'status-dot'} />{connecting ? 'Connecting' : health ? 'API connected' : 'API offline'}</button>
          {user ? <><span className="profile-avatar">{user.username.slice(0, 1).toUpperCase()}</span><div className="profile-text"><strong>{user.username}</strong><small>{formatRole(user.role)}{!user.approved && ' · Pending'}</small></div><button className="icon-button" onClick={() => void handleLogout()} disabled={busy || authBusy || !identityReady} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button></> : <><button className="button signin-button" disabled={authBusy} onClick={() => openAuth('login')}>Sign in</button><button className="button primary header-signup" disabled={authBusy} onClick={() => openAuth('register')}>Create account <ArrowUpRight size={16} /></button></>}
        </div>
      </header>

      <main className="page-content" id="main-content" ref={mainRef} tabIndex={-1}>
        {notice && <div className={`notice ${notice.kind}`} role="status"><span>{notice.kind === 'success' ? <CheckCheck size={18} /> : <CircleHelp size={18} />}{notice.text}</span><button className="icon-button" onClick={() => setNotice(null)} aria-label="Dismiss notification"><X size={17} /></button></div>}
        {user && !user.approved && <div className="approval-banner"><LockKeyhole size={18} /><p><strong>Your professional account is awaiting approval.</strong> Explore public resources while the workspace administrator verifies your access.</p></div>}

        {page === 'overview' && <>
          {!user ? <>
            <section className="landing-hero" aria-labelledby="landing-title">
              <div className="hero-copy"><p className="eyebrow"><span className="eyebrow-line" /> EDUCATION · RESEARCH · UNDERSTANDING</p><h1 id="landing-title">Breast health,<br />with a clearer<br /><em>perspective.</em></h1><p>Understand the essentials. Explore the research. Find reliable reading and a focused workspace for every stage of learning.</p><div className="hero-actions"><a className="button primary" href="#prediction">Open prediction calculator <ArrowRight size={18} /></a><button className="button quiet" onClick={() => openAuth('register')}>Find your workspace <ArrowUpRight size={18} /></button></div><div className="hero-footnote"><ShieldCheck size={17} /> Source-linked resources. Access shaped around your role.</div></div>
              <ResearchVisual />
            </section>
            <div className="source-strip"><span>OUR READING REFERENCES</span><a href="https://www.cancer.gov/types/breast" target="_blank" rel="noopener noreferrer">National Cancer Institute <ArrowUpRight size={14} /></a><a href="https://www.who.int/news-room/fact-sheets/detail/breast-cancer" target="_blank" rel="noopener noreferrer">World Health Organization <ArrowUpRight size={14} /></a><a href="https://archive.ics.uci.edu/dataset/17/breast+cancer+wisconsin+diagnostic" target="_blank" rel="noopener noreferrer">UCI Machine Learning Repository <ArrowUpRight size={14} /></a></div>
            <section id="workspaces" className="workspaces-section"><div className="section-heading"><div><p className="eyebrow">01 / YOUR STARTING POINT</p><h2>One platform.<br />Four perspectives.</h2></div><p className="section-description">A patient’s questions and a researcher’s questions are different. Your workspace should reflect that.</p></div><div className="role-grid">{roles.map((role, index) => <article className={`role-card ${role.color}`} key={role.id}><div className="role-card-top"><span className="role-icon"><role.icon size={25} strokeWidth={1.7} /></span><span className="role-number">0{index + 1}</span></div><h3>{role.label}</h3><p>{role.description}</p><button className="text-button role-link" onClick={() => openAuth('register', role.id)}>Enter workspace <ArrowUpRight size={18} /></button></article>)}</div></section>
          </> : <>
            <div className="page-heading"><div><p className="eyebrow">{formatRole(user.role).toUpperCase()} WORKSPACE</p><h1>Welcome back, {user.username}.</h1><p>{user.role === 'patient' ? 'Clear explanations and useful reading for your next conversation.' : user.role === 'student' ? 'Connect your reading with hands-on measurement practice.' : 'Your research resources and measurement workflow, in one place.'}</p></div><span className="pill">{user.approved ? <Check size={15} /> : <LockKeyhole size={15} />}{user.approved ? 'Account active' : 'Approval pending'}</span></div>
            <section className="workspace-welcome"><div><p className="eyebrow">PICK UP FROM HERE</p><h2>{accessible ? user.role === 'student' ? 'Put your learning into practice.' : 'Prepare your next assessment.' : 'Build a clearer understanding.'}</h2><p>{accessible ? 'Open a case, review the measurement groups, and validate your inputs before taking the next step.' : 'Explore reliable reading and save useful articles for this session.'}</p><button className="button primary" onClick={() => navigate(accessible ? 'assessment' : 'library')}>{accessible ? 'Open measurement workspace' : 'Open learning library'}<ArrowRight size={18} /></button></div><div className="workspace-shortcuts"><button onClick={() => navigate('library')}><BookOpen size={21} /><span><strong>Learning library</strong><small>{resources.length} resources available</small></span><ArrowUpRight size={18} /></button>{accessible && <button onClick={() => navigate('history')}><History size={21} /><span><strong>Session history</strong><small>{history.length} recent {history.length === 1 ? 'case' : 'cases'}</small></span><ArrowUpRight size={18} /></button>}<button onClick={() => { setFilter('Saved'); navigate('library'); }}><CheckCheck size={21} /><span><strong>Your reading list</strong><small>{saved.length} saved for this session</small></span><ArrowUpRight size={18} /></button></div></section>
          </>}
          <section className="reading-section"><div className="section-heading"><div><p className="eyebrow">02 / FROM THE LEARNING LIBRARY</p><h2>{activeRole && user?.approved ? `Selected for ${activeRole.label.toLowerCase()}` : 'A little context goes a long way.'}</h2></div><button className="text-button view-all" onClick={() => navigate('library')}>Browse all resources <ArrowRight size={17} /></button></div>{libraryFeedback() || libraryCards(resources.slice(0, 3))}</section>
          <section className="project-callout"><div className="callout-icon"><FlaskConical size={30} /></div><div><p className="eyebrow">03 / BEHIND THE RESEARCH</p><h2>From cell measurements to considered research.</h2><p>Explore the project’s LRMeta stacking approach, measurement workflow, and role permissions.</p></div><button className="button secondary" onClick={() => navigate('about')}>About the project <ArrowUpRight size={17} /></button></section>
        </>}

        {page === 'prediction' && <PredictionCalculator schema={schema} health={health} connecting={connecting} reconnect={() => void connect()} />}

        {page === 'library' && <>
          <div className="page-heading"><div><p className="eyebrow rose-text">MAKE ROOM FOR UNDERSTANDING</p><h1>Your learning library</h1><p>Clear explanations, thoughtful reading, and sources you can explore.</p></div><span className="pill"><BookOpen size={15} /> {user?.approved ? formatRole(user.role) : 'Public'} collection</span></div>
          <div className="library-banner"><div><BookOpen size={29} strokeWidth={1.4} /><div><h3>Good questions deserve reliable answers.</h3><p>Every article includes a link to its original medical or research source.</p></div></div><span>CURATED WITH PURPOSE</span></div>
          {libraryError && <div className="library-fallback" role="status"><BookOpen size={18} /><span>You’re viewing the public collection. Account-specific resources will return when the service is available.</span><button className="text-button" onClick={() => setLibraryRefresh(value => value + 1)}>Retry <RefreshCw size={14} /></button></div>}
          <div className="library-toolbar"><div className="filter-tabs" aria-label="Library filters">{['All resources', 'Saved'].map(tab => <button key={tab} className={filter === tab ? 'selected' : ''} aria-pressed={filter === tab} onClick={() => setFilter(tab)}>{tab}{tab === 'Saved' && <span>{saved.length}</span>}</button>)}</div><label className="search-field"><Search size={17} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search topics, questions, keywords…" aria-label="Search learning resources" />{search && <button className="icon-button" onClick={() => setSearch('')} aria-label="Clear search"><X size={15} /></button>}</label></div>
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
              <div className="measurement-tabs" role="tablist" aria-label="Measurement groups">{schema.groups.map((item, index) => <button role="tab" id={`tab-${item.id}`} aria-controls={`panel-${item.id}`} aria-selected={group === item.id} tabIndex={group === item.id ? 0 : -1} onKeyDown={event => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                const next = event.key === 'Home' ? 0 : event.key === 'End' ? schema.groups.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + schema.groups.length) % schema.groups.length;
                setGroup(schema.groups[next].id);
                document.getElementById(`tab-${schema.groups[next].id}`)?.focus();
              }} key={item.id} className={group === item.id ? 'selected' : ''} onClick={() => setGroup(item.id)}><span>0{index + 1}</span>{item.id === 'mean' ? 'Mean' : item.id === 'se' ? 'Standard error' : 'Worst'}<small>{schema.features.filter(field => field.group === item.id && values[field.name]?.trim()).length}/{schema.features.filter(field => field.group === item.id).length}</small></button>)}</div>
              <div className="group-intro"><h3>{schema.groups.find(item => item.id === group)?.label}</h3><p>{schema.groups.find(item => item.id === group)?.description}</p></div>
              <div className="measurement-fields" role="tabpanel" id={`panel-${group}`} aria-labelledby={`tab-${group}`}>{schema.features.filter(field => field.group === group).map(field => <label key={field.name} className={`measurement-field ${errors[field.name] ? 'invalid' : ''}`} htmlFor={field.name}><span>{field.label}</span><input id={field.name} type="number" min={field.minimum} step="any" value={values[field.name] || ''} placeholder="0.000" disabled={busy} aria-invalid={!!errors[field.name]} aria-describedby={`${field.name}-help`} onChange={event => { setValues(previous => ({ ...previous, [field.name]: event.target.value })); setErrors(previous => { const next = { ...previous }; delete next[field.name]; return next; }); setValidated(false); setModelPending(false); setPrediction(null); setIsExample(false); }} /><small id={`${field.name}-help`}>{errors[field.name] || field.description}</small></label>)}</div>
              <div className="measurements-footer"><span><ShieldCheck size={14} /> Finite, non-negative numbers only</span><div><button className="text-button" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={15} /> Import JSON</button><button className="text-button" onClick={() => { resetAssessment(); setNotice(null); }} disabled={busy}><RefreshCw size={14} /> Reset</button></div><input ref={fileRef} className="visually-hidden" type="file" accept=".json,application/json" aria-label="Import measurements from JSON" onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); event.target.value = ''; }} /></div>
            </section>
            <aside className="assessment-summary"><section className="summary-card"><div className="summary-title"><h3>Assessment overview</h3><ClipboardList size={18} /></div><div className="completion-ring" style={{ '--progress': `${filled / schema.feature_order.length * 360}deg` } as CSSProperties}><div><strong>{filled}<span>/{schema.feature_order.length}</span></strong><small>inputs complete</small></div></div><div className="summary-groups">{schema.groups.map(item => { const fields = schema.features.filter(field => field.group === item.id); const count = fields.filter(field => values[field.name]?.trim() && !validateValues({ [field.name]: values[field.name] }, { ...schema, features: [field] })[field.name]).length; return <div key={item.id}><span><span className={`mini-dot ${count === fields.length ? 'complete' : ''}`} />{item.label}</span><strong>{count} / {fields.length}</strong></div>; })}</div><div className="summary-divider" /><div className={`model-status ${validated ? 'input-ready' : ''}`}><span>{validated ? <CheckCheck size={19} /> : <LockKeyhole size={19} />}</span><div><strong>{prediction ? 'Assessment returned' : modelPending ? 'Awaiting model integration' : validated ? 'Inputs validated' : 'Ready when you are'}</strong><p>{prediction ? 'Review the response below.' : modelPending ? 'The prediction service is not available yet.' : validated ? 'All measurements passed input validation.' : 'Complete the required measurements to continue.'}</p></div></div>{prediction && <div className="prediction-result"><span>Prediction response</span><strong>{prediction.prediction}</strong>{prediction.probability !== null && <p>Estimated malignancy probability: {(prediction.probability * 100).toFixed(1)}%</p>}<small>Interpret with the model’s intended use and validation evidence.</small></div>}
              <button className="button primary full-width" disabled={busy || authBusy || !health} onClick={() => void submitAssessment(predictionAllowed)}>{busy ? <LoaderCircle size={17} className="spin" /> : <ShieldCheck size={17} />}{busy ? 'Checking inputs…' : predictionAllowed ? 'Request assessment' : 'Validate measurements'}{!busy && <ArrowRight size={16} />}</button>
              <button className="button secondary full-width" disabled={busy || filled !== schema.feature_order.length} onClick={() => { if (checkInputs()) downloadJson(currentPayload()); }}><ArrowDownToLine size={15} /> Export inputs</button>
              {isExample && <p className="example-label">Synthetic example · no diagnostic meaning</p>}{user?.role === 'student' && <p className="student-note">Your student account can validate and export practice inputs. The public calculator is available from the navigation.</p>}
            </section><section className="privacy-card"><ShieldCheck size={20} /><h4>Thoughtful about your data.</h4><p>Measurements stay in this session. The API validates them without storing them. Use a reference code instead of a person’s name.</p></section></aside></div>
          </>}
        </>}

        {page === 'history' && accessible && <>
          <div className="page-heading"><div><p className="eyebrow rose-text">YOUR WORK, IN ONE PLACE</p><h1>Session history</h1><p>Revisit input validations from your current browser session.</p></div>{history.length > 0 && <button className="button secondary" onClick={() => setHistory([])}><Trash2 size={15} /> Clear session</button>}</div>
          <div className="session-note"><ShieldCheck size={17} /> History is kept in memory and cleared when you refresh or sign out. Up to 50 recent entries are shown.</div>
          {history.length ? <div className="history-table-wrap"><table className="history-table"><thead><tr><th>Case reference</th><th>Time</th><th>Measurements</th><th>Status</th><th><span className="visually-hidden">Actions</span></th></tr></thead><tbody>{history.map(entry => <tr key={entry.id}><td><span className="case-icon"><FileJson size={18} /></span><strong>{entry.payload.sample_id || 'Unnamed case'}</strong></td><td>{new Date(entry.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</td><td>{Object.keys(entry.payload.features).length} inputs</td><td><span className={`history-status ${entry.status === 'Validated' ? 'valid' : ''}`}>{entry.status}</span></td><td><div className="history-actions"><button className="text-button" onClick={() => { setValues(Object.fromEntries(Object.entries(entry.payload.features).map(([name, value]) => [name, String(value)]))); setSampleId(entry.payload.sample_id || ''); setValidated(false); setModelPending(false); setPrediction(null); setErrors({}); setIsExample(false); navigate('assessment'); }}>Reopen <ArrowUpRight size={14} /></button><button className="icon-button" onClick={() => downloadJson(entry.payload)} aria-label={`Export ${entry.payload.sample_id || 'case'}`}><ArrowDownToLine size={16} /></button></div></td></tr>)}</tbody></table></div> : <div className="empty-state"><History size={32} /><h3>A fresh start.</h3><p>Your validated cases will appear here as you use the assessment workspace.</p><button className="button primary" onClick={() => navigate('assessment')}>Start an assessment <ArrowRight size={16} /></button></div>}
        </>}

        {page === 'about' && <AboutPage navigate={navigate} />}
        {page === 'model' && <ModelPage key={user?.id ?? 'guest'} user={user} ready={identityReady} signIn={() => openAuth('login', 'student')} />}
        {page === 'dataset' && <DatasetUploadPage />}
        {page === 'shap' && <ShapExplorerPage />}
        
      </main>
      <SiteFooter navigate={navigate} openPrivacy={() => setPrivacyOpen(true)} />
    </div>

    {privacyOpen && <Modal title="Privacy & your data" close={closePrivacy}>
      <div className="article-body"><p><strong>Your account.</strong> The server stores your username, role, approval status, a salted password hash, and session records so you can sign in and access the appropriate tools.</p><p><strong>Your measurements.</strong> Submitted inputs are sent to the API for processing. The current application does not persist measurements in the account database. Use a non-identifying case reference.</p><p><strong>This browser session.</strong> Case history and your reading list are held in memory and cleared on refresh or sign-out. JSON exports remain on your device until you remove them.</p><p><strong>External resources.</strong> Other websites manage their own privacy practices. Source links open in a new tab.</p></div>
    </Modal>}
    {authMode && <Modal title={authMode === 'login' ? 'Welcome to your workspace' : 'Create your workspace'} close={closeAuth} wide className="auth-modal">
      <div className="auth-layout"><aside className="auth-story"><span className="auth-story-icon"><HeartHandshake size={32} strokeWidth={1.5} /></span><p className="eyebrow">YOUR OWN STARTING POINT</p><h3>Knowledge for<br />your perspective.</h3><p>One account connects your learning resources and the tools available to your role.</p><ul><li><Check size={16} /> Curated, source-linked reading</li><li><Check size={16} /> A workspace shaped around your role</li><li><ShieldCheck size={16} /> Professional access reviewed before approval</li></ul><span className="auth-story-bottom">PATIENTS · STUDENTS · RESEARCHERS · DOCTORS</span></aside><section className="auth-panel">
      <p className="modal-description">{authMode === 'login' ? 'Sign in to continue learning and exploring.' : 'Choose your role and create a personal learning workspace.'}</p>
      <form className="auth-form" aria-busy={authBusy} onSubmit={event => void handleAuth(event)}>
        {authMode === 'register' && <fieldset className="auth-role-picker"><legend>I’m here as a…</legend><div>{roles.map(role => <button type="button" key={role.id} className={authRole === role.id ? 'selected' : ''} onClick={() => setAuthRole(role.id)} disabled={authBusy} aria-pressed={authRole === role.id}><role.icon size={18} /><span>{formatRole(role.id)}</span>{authRole === role.id && <Check size={14} />}</button>)}</div></fieldset>}
        {authMode === 'register' && (authRole === 'doctor' || authRole === 'researcher') && <div className="auth-approval-note"><LockKeyhole size={17} /><p>Professional tools require approval by the workspace administrator. Public learning resources are available while you wait.</p></div>}
        <AuthFields key={authMode} mode={authMode} busy={authBusy} />
        {authError && <div className="inline-error" role="alert">{authError}</div>}
        <button className="button primary full-width" disabled={authBusy || !identityReady}>{authBusy ? <LoaderCircle size={17} className="spin" /> : null}{authBusy ? 'Opening your workspace…' : authMode === 'login' ? 'Sign in' : 'Create my workspace'}<ArrowRight size={17} /></button>
      </form>
      <p className="auth-switch">{authMode === 'login' ? 'New here?' : 'Already have a workspace?'} <button className="text-button" disabled={authBusy} onClick={() => { setAuthMode(authMode === 'login' ? 'register' : 'login'); setAuthError(''); }}>{authMode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
      <div className="auth-privacy"><ShieldCheck size={14} /> Use a non-identifying username. Keep personal medical details out of account fields.</div>
      </section></div>
    </Modal>}
    {article && <Modal title={article.title} close={closeArticle} wide>
      <div className="article-meta"><span className="pill">{article.category}</span><span><Clock3 size={14} /> {article.reading_minutes} min read</span></div><p className="article-summary">{article.summary}</p><div className="article-body">{article.body.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div><div className="article-source"><ShieldCheck size={20} /><div><span>READ THE ORIGINAL SOURCE</span><a href={article.source.url} target="_blank" rel="noopener noreferrer">{article.source.label}<ArrowUpRight size={16} /></a></div></div><div className="article-bottom"><p>For learning and discussion. This article does not provide personal medical advice.</p><button className="button secondary" onClick={() => toggleSaved(article.id)}>{saved.includes(article.id) ? <Check size={16} /> : <Plus size={16} />}{saved.includes(article.id) ? 'Saved to your reading list' : 'Save for this session'}</button></div>
    </Modal>}
  </div>;
}
