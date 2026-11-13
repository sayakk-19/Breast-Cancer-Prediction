import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, Check, FlaskConical, LoaderCircle, RotateCcw, ScanLine } from 'lucide-react';
import { request, validateValues, getToken } from './api';
import type { FeatureSchema, Health, User } from './api';
import rows from './measurementRows.json';
import './prediction.css';

const groups = [
  { id: 'mean', label: 'Mean' },
  { id: 'se', label: 'Standard error' },
  { id: 'worst', label: 'Worst' },
] as const;
const fields = rows.flatMap(row => groups.map(group => ({
  name: row.key + '_' + group.id, label: row.label, group: group.id,
  minimum: 0, unit: null, description: '',
})));
const localSchema: FeatureSchema = {
  features: fields, feature_order: fields.map(field => field.name), groups: [], disclaimer: '',
};
const example = Object.fromEntries(rows.flatMap(row => groups.map(group =>
  [row.key + '_' + group.id, String(row.example[group.id])],
)));

type Result = { status: 'completed'; probability: number; prediction: 'benign' | 'malignant'; threshold: number };
type Props = { user: User | null; signIn: () => void; schema: FeatureSchema | null; health: Health | null; connecting: boolean; reconnect: () => void };

function percent(value: number) {
  const n = value * 100;
  if (n > 0 && n < 0.1) return '<0.1%';
  if (n > 99.9 && n < 100) return '>99.9%';
  return n.toLocaleString(undefined, { maximumFractionDigits: 1 }) + '%';
}

export default function PredictionCalculator({ user, signIn, schema, health, connecting, reconnect }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [exampleLoaded, setExampleLoaded] = useState(false);
  const resultPanel = useRef<HTMLElement>(null);
  const inputSchema = schema ?? localSchema;
  const missing = validateValues(values, inputSchema);
  const filled = fields.length - Object.keys(missing).length;
  const ready = health?.prediction_available === true;

  async function downloadReport() {
    if (!user) { signIn(); return; }
    setDownloading(true); setMessage('');
    try {
      const token = getToken();
      const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
      const response = await fetch(base + '/api/v1/calculator/report', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ features: Object.fromEntries(inputSchema.feature_order.map(name => [name, Number(values[name])])) }),
      });
      if (response.status === 401) { signIn(); return; }
      if (!response.ok) throw new Error('The report could not be generated. Please retry.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a'); link.href = url; link.download = 'cellscope-report.pdf'; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Report download failed.'); }
    finally { setDownloading(false); }
  }

  function replaceValues(next: Record<string, string>, isExample: boolean) {
    setValues(next); setErrors({}); setResult(null); setMessage(''); setExampleLoaded(isExample);
  }

  function edit(name: string, value: string) {
    setValues(previous => ({ ...previous, [name]: value }));
    setErrors(previous => { const next = { ...previous }; delete next[name]; return next; });
    setResult(null); setMessage(''); setExampleLoaded(false);
  }

  async function calculate(event: FormEvent) {
    event.preventDefault();
    if (busy || !ready) return;
    setErrors(missing); setResult(null);
    const first = fields.find(field => missing[field.name]);
    if (first) {
      setMessage('Complete the highlighted measurements to calculate a probability.');
      document.getElementById('calc-' + first.name)?.focus();
      return;
    }
    setBusy(true); setMessage('');
    try {
      const features = Object.fromEntries(inputSchema.feature_order.map(name => [name, Number(values[name])]));
      const score = await request<Result>('/calculator/predict', {
        method: 'POST', credentials: 'omit', body: JSON.stringify({ features }),
      });
      if (score.status !== 'completed' || !Number.isFinite(score.probability) ||
          score.probability < 0 || score.probability > 1 || !Number.isFinite(score.threshold) ||
          score.threshold <= 0 || score.threshold >= 1 ||
          score.prediction !== (score.probability >= score.threshold ? 'malignant' : 'benign')) {
        throw new Error('A valid score could not be read. Please try again.');
      }
      setResult(score);
      requestAnimationFrame(() => resultPanel.current?.focus({ preventScroll: false }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'The estimate could not be calculated. Please try again.');
    } finally { setBusy(false); }
  }

  return <div className="calc-page">
    <header className="calc-intro">
      <div><p className="calc-kicker">SPECIMEN ANALYSIS</p><h1>Prediction calculator</h1>
        <p>Enter the 30 cell-nucleus measurements from a fine-needle aspirate of a breast mass to estimate its probability of malignancy.</p>
      </div>
      <svg className="calc-specimen" viewBox="0 0 190 128" fill="none" aria-hidden="true">
        <g stroke="currentColor"><path d="M26 31V17h14m107 0h14v14m0 64v14h-14m-107 0H26V95" opacity=".64" />
          <path d="M58 43c14-18 36-15 53-13 21 1 34 20 30 38-6 23-26 31-45 30-25 0-48-18-48-35 0-9 3-15 10-20Z" fill="currentColor" fillOpacity=".08" />
          <path d="M72 49c13-13 29-12 41-5s16 24 4 36-28 10-40 3-18-20-5-34Z" strokeDasharray="3 4" />
          <path d="M94 64h45m-2-4v8M90 64h8m-4-4v8" /><circle cx="94" cy="64" r="3" fill="currentColor" />
        </g>
      </svg>
    </header>

    <form className="calc-layout" onSubmit={calculate} noValidate>
      <section className="calc-sheet" aria-labelledby="calc-input-heading">
        <div className="calc-sheet-head"><div><p className="calc-caption">01 / INPUT</p><h2 id="calc-input-heading">Cell measurements</h2></div>
          <button type="button" className="calc-example" disabled={busy} onClick={() => replaceValues(example, true)}><FlaskConical size={15} />Load example</button>
        </div>
        <p className="calc-guide">Use the values from one specimen. Each row needs a mean, standard error, and worst value.</p>
        <div className="calc-progress"><span>{exampleLoaded ? 'Dataset example' : 'Measurements entered'}</span><strong>{filled} / 30</strong></div>
        <progress className="calc-track" value={filled} max={30} aria-label="Measurements completed" />
        <table className="calc-table">
          <caption className="visually-hidden">Specimen measurements in three groups</caption>
          <thead><tr><th scope="col">Feature</th>{groups.map(group => <th key={group.id} scope="col">{group.label}</th>)}</tr></thead>
          <tbody>{rows.map((row, index) => <tr key={row.key}>
            <th scope="row"><span className="calc-index">{String(index + 1).padStart(2, '0')}</span>{row.label}</th>
            {groups.map(group => {
              const key = row.key + '_' + group.id;
              return <td key={key}><input id={'calc-' + key} type="number" inputMode="decimal" min="0" step="any"
                aria-label={row.label + ', ' + group.label} aria-required="true" aria-invalid={!!errors[key]}
                aria-describedby={errors[key] ? 'error-' + key : undefined} placeholder="—" value={values[key] ?? ''}
                disabled={busy} onChange={event => edit(key, event.target.value)} />
                {errors[key] && <small id={'error-' + key}>{errors[key]}</small>}</td>;
            })}
          </tr>)}</tbody>
        </table>
        <div className="calc-bottom"><span>30 values · One specimen</span><button type="button" className="text-button" disabled={busy || !Object.keys(values).length} onClick={() => replaceValues({}, false)}><RotateCcw size={15} />Clear inputs</button></div>
      </section>

      <aside className="calc-side"><section className="calc-result" ref={resultPanel} tabIndex={-1} aria-labelledby="calc-result-heading">
        <p className="calc-caption">02 / RESULT</p><h2 id="calc-result-heading">Malignancy estimate</h2>
        <div aria-live="polite" aria-atomic="true">
          {result ? <div className="calc-score"><span>{exampleLoaded ? 'Example specimen' : 'Submitted specimen'}</span>
            <strong>{percent(result.probability)}</strong>
            <div className="calc-score-scale" aria-hidden="true"><i style={{ width: (100 * result.probability) + '%' }} /><b style={{ left: (100 * result.threshold) + '%' }} /></div>
            <p>Model classification <strong>{result.prediction === 'benign' ? 'Benign' : 'Malignant'}</strong></p>
            <small>Malignant classification begins at {percent(result.threshold)}.</small>
          </div> : <div className="calc-empty"><ScanLine size={32} strokeWidth={1.3} /><strong>{busy ? 'Calculating estimate…' : 'Awaiting calculation'}</strong><p>Your specimen’s score will appear here.</p></div>}
        </div>
        {message && <p role="alert" className="calc-error">{message}</p>}
        {!ready && <div className="calc-availability" role="status">{connecting ? 'Checking service availability…' : <>{health ? 'The prediction model is unavailable.' : 'The prediction service is offline.'} <button type="button" className="text-button" onClick={reconnect}>Retry connection</button></>}</div>}
        {result && <div role="status" className={'calc-outcome ' + result.prediction}><strong>{result.prediction === 'malignant' ? 'Model result: likely malignant' : 'Model result: likely benign'}</strong><p>{result.prediction === 'malignant' ? 'Please arrange clinical review of this finding.' : 'This result does not rule out cancer. Clinical confirmation is still needed.'}</p></div>}
        <div className={result?.prediction === 'malignant' ? 'calc-warning-outline' : ''}><button type="submit" className="button primary full-width" disabled={busy || !ready}>{busy ? <LoaderCircle size={17} className="spin" /> : null}{busy ? 'Calculating…' : 'Calculate probability'}<ArrowRight size={17} /></button></div>
        {result && <button type="button" className="button secondary full-width" disabled={downloading || busy} onClick={() => void downloadReport()}>{downloading ? 'Preparing report…' : 'Download PDF report'}</button>}
      </section>
      <section className="calc-notes"><p className="calc-caption">INTERPRETING THE SCORE</p>
        <p>The percentage estimates how likely the <strong>measured mass</strong> is to be malignant. A clinician interprets the findings alongside your pathology report.</p>
        <a href="https://archive.ics.uci.edu/dataset/17/breast+cancer+wisconsin+diagnostic" target="_blank" rel="noopener noreferrer">About the training data <ArrowUpRight size={14} /></a>
      </section><p className="calc-private"><Check size={15} />No account required. Measurements are processed without being saved.</p></aside>
    </form>
  </div>;
}

