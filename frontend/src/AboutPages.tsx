import { useEffect, useRef, useState } from 'react';
import { ArrowRight, BookOpen, FlaskConical, LockKeyhole, Pause, Play, ShieldCheck } from 'lucide-react';
import { ApiError, request } from './api';
import type { User } from './api';
import './about.css';

type Step = { title: string; tag: string; summary: string; details: string[]; visual: string };
type Guide = {
  title: string; subtitle: string; provenance: string;
  dataset: { total: number; features: number; benign: number; malignant: number; splits: { name: string; count: number }[] };
  steps: Step[]; models: { name: string; detail: string }[];
  metrics: Record<'validation' | 'test', Record<string, number>> | null;
  sources: { label: string; url: string }[];
};

export function useAboutAlert() {
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    shown.current = true;
    try {
      if (sessionStorage.getItem('cellscope-about-seen') === '1') return;
      sessionStorage.setItem('cellscope-about-seen', '1');
    } catch { /* The alert still works when browser storage is unavailable. */ }
    window.alert('Welcome to CellScope. Before using the prediction calculator, visit the About page to understand how it works, which measurements you need, and what the result means.');
  }, []);
}

function CellImage() {
  return <svg viewBox="0 0 420 300" role="img" aria-label="Illustration of cell nuclei and their measured outlines, not a medical scan">
    <circle cx="210" cy="145" r="119" fill="none" stroke="currentColor" opacity=".2" />
    <circle cx="210" cy="145" r="95" fill="none" stroke="currentColor" opacity=".2" strokeDasharray="3 8" />
    {[[155,105,29],[255,115,35],[205,200,31]].map(([x,y,r], i) => <g key={x} className="about-cell" style={{ animationDelay: `${i * -.9}s` }}><ellipse cx={x} cy={y} rx={r} ry={r + 10} fill={i === 2 ? '#e6b7ac' : '#bfd4b5'} transform={`rotate(${i * 22} ${x} ${y})`} /><ellipse cx={x} cy={y} rx={r * .43} ry={r * .55} fill={i === 2 ? '#885a54' : '#365d50'} /></g>)}
    <path d="M160 105H60M255 115h100M205 200v65" stroke="currentColor" opacity=".6" />
    <text x="15" y="94" fill="currentColor" fontSize="13">Radius</text><text x="322" y="102" fill="currentColor" fontSize="13">Texture</text><text x="216" y="265" fill="currentColor" fontSize="13">Perimeter</text>
  </svg>;
}

export function AboutPage({ navigate }: { navigate: (page: 'prediction' | 'model') => void }) {
  return <div className="about-page">
    <section className="about-hero"><div><p className="eyebrow">ABOUT CELLSCOPE</p><h1>Understand the process.<br /><em>Put the result in context.</em></h1><p className="about-lead">A learning space and a specimen-based prediction calculator, built to make the journey from cell measurements to a model estimate easier to understand.</p><button className="button primary" onClick={() => navigate('prediction')}>Open the calculator <ArrowRight size={18} /></button></div><figure className="about-illustration"><CellImage /><figcaption>Illustration of cell measurements · not diagnostic imagery</figcaption></figure></section>
    <section className="about-section"><p className="eyebrow">HOW TO USE IT</p><h2>Three steps, with context at every stage.</h2><div className="about-how">
      <article><span>01</span><h3>Start with measurements</h3><p>Use the 30 numerical features measured from a breast-mass specimen: ten characteristics, each with a mean, standard error and worst value. These are laboratory-derived values, not answers to a symptom questionnaire.</p></article>
      <article><span>02</span><h3>Enter and review</h3><p>Open Prediction calculator, fill every field and check the values before submitting. The dataset example is for exploring the interface. You do not need to sign in to calculate a result.</p></article>
      <article><span>03</span><h3>Read the estimate carefully</h3><p>The result is the model’s estimated probability of a malignant specimen, with a classification label. It does not measure lifetime cancer risk or replace a clinician’s assessment.</p></article>
    </div></section>
    <section className="about-context"><BookOpen size={30} /><div><h2>A percentage needs an explanation.</h2><p>A specimen probability describes one submitted set of measurements. Dataset accuracy describes how often the model classified an evaluation set correctly. They answer different questions; a high test accuracy does not make every individual result certain.</p></div></section>
    <section className="about-section about-access"><div><p className="eyebrow">A PLACE FOR EACH PERSPECTIVE</p><h2>Learn openly. Explore the research with an account.</h2><p>Visitors can use the calculator and public learning resources. Students can access the model walkthrough after signing in. Researchers can access it after account approval. Doctors retain their professional assessment workspace.</p></div><article><ShieldCheck size={26} /><h3>Your data, in context</h3><p>Calculator inputs are processed in memory. They are not saved as patient records. Account information and sessions are stored separately. Avoid entering names or other identifying details.</p></article></section>
    <section className="about-final"><p className="eyebrow">GO BEHIND THE BUILD</p><h2>Want to know how this has been built?</h2><p>Follow the dataset, training process, ensemble architecture and recorded results in the model walkthrough.</p><button className="button primary" onClick={() => navigate('model')}>Click here to explore the model <ArrowRight size={18} /></button><small><LockKeyhole size={14} /> Students and approved researchers only · sign-in required</small></section>
  </div>;
}

function WorkflowImage({ kind, models }: { kind: string; models: Guide['models'] }) {
  if (kind === 'cells') return <CellImage />;
  if (kind === 'folds') return <div className="fold-visual" role="img" aria-label="Five folds. Each row holds out a different fold while the other four train.">{[0,1,2,3,4].map(row => <div key={row}><span>Run {row + 1}</span>{[0,1,2,3,4].map(col => <i key={col} className={row === col ? 'holdout' : ''}>{row === col ? 'Holdout' : 'Train'}</i>)}</div>)}<p>Every training record receives a prediction from models that did not train on it.</p></div>;
  if (kind === 'ensemble') return <div className="ensemble-visual"><span className="flow-node">30 measurements</span><div className="flow-line" /><div className="learner-grid">{models.map(model => <span key={model.name}>{model.name}</span>)}</div><div className="flow-line" /><span className="flow-node">9 probabilities → Logistic Regression</span><div className="flow-line" /><span className="flow-node accent">Malignant-class probability</span></div>;
  const labels = kind === 'split' ? ['569 records', '364 train · 91 validation · 114 test', 'Keep evaluation data separate'] : kind === 'results' ? ['Predict held-out records', 'Compare labels & probabilities', 'Accuracy · Precision · Recall · F1 · ROC-AUC'] : ['React · 30 inputs', 'FastAPI · validate & align', 'Saved ensemble · probability', 'React · explain the result'];
  return <div className="simple-flow" role="img" aria-label={labels.join(', then ')}>{labels.map((label,i) => <div key={label}>{i > 0 && <div className="flow-line" />}<span className="flow-node">{label}</span></div>)}</div>;
}

export function ModelPage({ user, ready, signIn }: { user: User | null; ready: boolean; signIn: () => void }) {
  const [guide, setGuide] = useState<Guide | null>(null);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  const [expired, setExpired] = useState(false);
  const permitted = !!user?.approved && (user.role === 'student' || user.role === 'researcher');
  useEffect(() => {
    setGuide(null); setError(''); setExpired(false);
    if (!ready || !permitted) return;
    let active = true;
    const load = () => request<Guide>('/model-guide').then(value => { if (active) { setGuide(value); setError(''); setExpired(false); } }).catch((reason: unknown) => {
      if (!active) return;
      setGuide(null);
      setExpired(reason instanceof ApiError && reason.status === 401);
      setError(reason instanceof Error ? reason.message : 'Unable to load the model walkthrough.');
    });
    void load();
    const refresh = () => { if (document.visibilityState === 'visible') void load(); };
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60000);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, [user?.id, user?.role, user?.approved, ready, permitted, retry]);
  if (!ready) return <div className="empty-state" role="status">Checking your session…</div>;
  if (!permitted) return <section className="empty-state model-gate"><LockKeyhole size={34} /><p className="eyebrow">MODEL WALKTHROUGH</p><h1>Learning, with the right access.</h1><p>{!user ? 'Sign in as a student or an approved researcher to explore how the model was built.' : user.role === 'researcher' ? 'Your researcher account is awaiting administrator approval. The model walkthrough will open once approved.' : 'This page is available only to students and approved researchers.'}</p>{!user && <button className="button primary" onClick={signIn}>Sign in to continue <ArrowRight size={18} /></button>}<a className="text-button" href="#about">Back to About</a></section>;
  if (error) return <div className="empty-state" role="alert"><h2>Walkthrough unavailable</h2><p>{error}</p><button className="button primary" onClick={expired ? signIn : () => setRetry(v => v + 1)}>{expired ? 'Sign in again' : 'Try again'}</button></div>;
  if (!guide) return <div className="empty-state" role="status">Loading the model walkthrough…</div>;
  const selected = guide.steps[step];
  return <div className={`model-page ${paused ? 'motion-paused' : ''}`}>
    <header className="model-heading"><div><p className="eyebrow">THE RESEARCH NOTEBOOK / EXPLAINED</p><h1>{guide.title}</h1><p>{guide.subtitle}</p></div><button className="button secondary" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? <Play size={16} /> : <Pause size={16} />}{paused ? 'Resume animations' : 'Pause animations'}</button></header>
    <section className="model-dataset" aria-label="Dataset overview"><div><strong>{guide.dataset.total}</strong><span>records</span></div><div><strong>{guide.dataset.features}</strong><span>features per record</span></div><div><strong>{guide.dataset.benign} / {guide.dataset.malignant}</strong><span>benign / malignant</span></div></section>
    <section className="model-section"><p className="eyebrow">EXPLORE THE WORKFLOW</p><h2>Six stages. One traceable prediction.</h2><div className="workflow-selector" aria-label="Workflow stages">{guide.steps.map((item,i) => <button key={item.title} aria-pressed={step === i} aria-controls="workflow-detail" onClick={() => setStep(i)}><span>0{i + 1}</span>{item.title}</button>)}</div><div className="workflow-detail" id="workflow-detail"><article key={selected.title}><p className="eyebrow">{selected.tag}</p><h3>{selected.title}</h3><p className="workflow-summary">{selected.summary}</p><ul>{selected.details.map(detail => <li key={detail}>{detail}</li>)}</ul></article><figure className="workflow-image"><WorkflowImage kind={selected.visual} models={guide.models} /><figcaption>Illustrative workflow diagram · select a stage to explore</figcaption></figure></div></section>
    <section className="model-section"><p className="eyebrow">DATA PARTITIONS</p><h2>Different records, different jobs.</h2><div className="split-bar" aria-hidden="true">{guide.dataset.splits.map(split => <span key={split.name} style={{ flex: split.count }} />)}</div><div className="split-labels">{guide.dataset.splits.map(split => <p key={split.name}><strong>{split.count} records</strong><span>{split.name} · {(split.count / guide.dataset.total * 100).toFixed(1)}%</span></p>)}</div></section>
    <section className="model-section"><p className="eyebrow">THE BASE LEARNERS</p><h2>Nine perspectives, combined.</h2><div className="model-roster">{guide.models.map((model,i) => <article key={model.name}><span>0{i + 1}</span><h3>{model.name}</h3><p>{model.detail}</p></article>)}</div></section>
    <section className="model-section model-results"><p className="eyebrow">RECORDED EXPORT RESULTS</p><h2>Read the evidence, not just the headline.</h2><p className="result-context">Validation and test scores from the saved ensemble. These describe dataset performance, not a visitor’s probability.</p>{guide.metrics ? <><div className="result-highlights">{(['validation','test'] as const).map(split => <article key={split}><span>{split === 'test' ? 'Held-out test' : 'Validation'} accuracy</span><strong>{(guide.metrics![split].Accuracy * 100).toFixed(2)}<small>%</small></strong><p>{split === 'test' ? '114' : '91'} evaluation records</p></article>)}</div><div className="metric-table-wrap"><table className="metric-table"><caption>Scores on a 0–1 scale. Bars share the same 0–1 axis.</caption><thead><tr><th scope="col">Metric</th><th scope="col">Validation</th><th scope="col">Test</th></tr></thead><tbody>{Object.keys(guide.metrics.validation).map(name => <tr key={name}><th scope="row">{name}</th>{(['validation','test'] as const).map(split => <td key={split}><span>{guide.metrics![split][name].toFixed(4)}</span><div className={`metric-track ${split}`} aria-hidden="true"><i style={{ width: `${guide.metrics![split][name] * 100}%` }} /></div></td>)}</tr>)}</tbody></table></div></> : <p role="status">Saved evaluation metrics are unavailable. No replacement scores are shown.</p>}<p className="model-provenance">{guide.provenance}</p><p>Precision asks how often a malignant prediction was correct; recall asks how many malignant cases were found. F1 balances these two measures. ROC-AUC measures ranking across thresholds. External validation and probability calibration are separate questions.</p></section>
    <footer className="model-sources"><FlaskConical size={23} /><div><h2>Keep exploring</h2><p>{guide.sources.map(source => <a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.label} ↗</a>)}</p><a href="#about">Return to About</a></div></footer>
  </div>;
}
