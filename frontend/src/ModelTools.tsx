import { useEffect, useState } from 'react';
import { request } from './api';
import type { User } from './api';
import { FileUp } from 'lucide-react';
import './model-tools.css';

type Summary = { rows: number; warnings: string[]; models: { name: string; accuracy: number | null; auc: number | null; mean_probability?: number; precision?: number; recall?: number; f1?: number; specificity?: number | null; false_negatives?: number; false_positives?: number }[] };
const postFile = async (path: string, file: File): Promise<Summary> => {
  const form = new FormData(); form.append('file', file);
  const base = (import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  let token: string | null = null;
  try { token = localStorage.getItem('cellscope_token'); } catch { /* Storage unavailable. */ }
  const response = await fetch(base + '/api/v1/' + path, { method: 'POST', credentials: 'include', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: form });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.detail;
    const message = typeof detail === 'string' ? detail : detail?.message;
    const fields = detail?.missing_features || detail?.invalid_features || [];
    throw new Error([message || `Analysis failed (HTTP ${response.status}). Check the backend logs and API URL.`, fields.length ? fields.join(', ') : '', detail?.guidance].filter(Boolean).join(' '));
  }
  if (!body || !Array.isArray(body.models)) throw new Error('The server returned an unexpected response. Check VITE_API_BASE_URL and redeploy the frontend.');
  return body;
};
function Results({ data, shap }: { data: Summary; shap: boolean }) {
  return <><h2>{data.rows} rows ready for review</h2>{data.warnings.map(message => <p className="dataset-warning" key={message}>{message}</p>)}
    {!shap && <details><summary>Detailed evaluation: precision, recall, F1 and errors</summary><div className="table-scroll"><table><thead><tr><th>Model</th><th>Precision</th><th>Recall</th><th>F1</th><th>Specificity</th><th>False negatives</th><th>False positives</th></tr></thead><tbody>{data.models.map(model => <tr key={model.name}><th>{model.name}</th>{(['precision','recall','f1','specificity'] as const).map(key => <td key={key}>{model[key] == null ? '—' : `${(model[key]! * 100).toFixed(1)}%`}</td>)}<td>{model.false_negatives ?? '—'}</td><td>{model.false_positives ?? '—'}</td></tr>)}</tbody></table></div><p>Metrics require known labels. Zero precision, recall or F1 may reflect an absent class or no positive predictions; ROC-AUC requires both classes.</p></details>}
    <div className="table-scroll"><table><thead><tr><th>{shap ? 'Feature' : 'Model'}</th><th>{shap ? 'Relative SHAP importance' : 'Accuracy'}</th>{!shap && <><th>ROC-AUC</th><th>Average malignancy estimate</th></>}</tr></thead><tbody>{data.models.map(model => <tr key={model.name}><th>{model.name}</th><td>{model.accuracy === null ? 'Valid diagnosis labels required' : `${(model.accuracy * 100).toFixed(1)}%`}</td>{!shap && <><td>{model.auc === null ? '—' : model.auc.toFixed(3)}</td><td>{model.mean_probability == null ? '—' : `${(model.mean_probability * 100).toFixed(1)}%`}</td></>}</tr>)}</tbody></table></div>{shap && <p>Relative importance is normalized within each tree model, then averaged. It does not indicate the direction of an effect or explain the complete ensemble.</p>}</>;
}
function ShapChart({ data }: { data: Summary }) {
  const top = data.models.slice(0, 15);
  const maximum = Math.max(...top.map(item => item.accuracy ?? 0), .001);
  return <figure className="shap-figure"><figcaption><h2>What influences the saved tree models?</h2><p>Actual SHAP results · Top 15 measurements · {data.rows} reference specimens</p></figcaption>
    <svg viewBox="0 0 760 530" role="img" aria-label="Horizontal chart of relative SHAP feature importance">
      {top.map((item, i) => <g key={item.name} transform={`translate(0,${i * 33 + 20})`}><text x="245" y="16" textAnchor="end" fill="currentColor" fontSize="13">{item.name.replaceAll('_', ' ')}</text><rect x="260" y="0" width={420 * (item.accuracy ?? 0) / maximum} height="23" rx="4" fill="var(--chart-bar)"/><text x={270 + 420 * (item.accuracy ?? 0) / maximum} y="16" fill="currentColor" fontSize="12">{((item.accuracy ?? 0) * 100).toFixed(1)}%</text></g>)}
    </svg><p>Relative importance, not a diagnosis or a direction of effect. Reference data may include training records.</p></figure>;
}
function CsvTool({ shap = false, user }: { shap?: boolean; user: User | null }) {
  const [reference, setReference] = useState<Summary | null>(null);
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<Summary | null>(null);
  useEffect(() => {
    if (!shap) return;
    let active = true; setBusy(true);
    request<Summary>('/dataset/shap').then(data => { if (active) setReference(data); })
      .catch(reason => { if (active) setError(reason.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [shap]);
  const run = async () => { if (!file) return; setBusy(true); setError(''); setResult(null); try { setResult(await postFile(shap ? 'dataset/shap' : 'dataset/analyze', file)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Analysis could not be completed.'); } finally { setBusy(false); } };
  const title = shap ? 'SHAP Explorer' : 'Dataset upload & model results';
  const description = shap ? 'Upload a CSV to see which measurements contribute most to each saved model output. Contributions explain a model estimate; they do not establish medical causes.' : 'Upload a CSV with one row per measured specimen. The app checks the 30 required features, explains preparation needs, and compares the saved models. Add diagnosis labels for metrics.';
  return <section className="model-tools"><p className="eyebrow">{shap ? 'MODEL INTERPRETABILITY' : 'MODEL WORKSPACE'}</p><h1>{title}</h1><p>{description}</p>
    {shap && (reference ? <ShapChart data={reference}/> : <div className="tool-card" role="status">{busy ? 'Calculating the reference SHAP chart from the saved models…' : 'Reference chart unavailable. You can try your breast cancer dataset below.'}</div>)}
    <section className="tool-card"><h2>Compare your breast cancer dataset with our trained models</h2><p>Upload laboratory-derived breast-mass measurements, not symptoms or a general health dataset. We check the column names and values; we cannot verify the clinical origin of a file.</p>
    <label className="dataset-drop" title="Select a breast cancer CSV from Downloads, Desktop, or any folder available in your device's file picker."><FileUp size={30}/><strong>{file?.name || 'Choose a breast cancer CSV from your device'}</strong><span>Up to 2,000 data rows · Maximum 5 MB · All 30 measurements required. Include diagnosis (B/M or 0/1) for evaluation metrics.</span><input type="file" disabled={busy} onChange={event => { const selected = event.target.files?.[0] ?? null; setResult(null); if (selected && (!selected.name.toLowerCase().endsWith('.csv') || selected.size > 5 * 1024 * 1024)) { setFile(null); setError('Choose a .csv file no larger than 5 MB.'); } else { setFile(selected); setError(''); } }} /></label>
    <button className="button primary" disabled={!file || busy} onClick={() => void run()}>{busy ? 'Analyzing…' : shap ? 'Generate explanations' : 'Check & compare models'}</button>
    {error && <p className="dataset-error" role="alert">{error}</p>}{result && <Results data={result} shap={shap}/>}
    {result && shap && <ShapChart data={result}/>}
    {!shap && user?.approved && ['doctor', 'researcher'].includes(user.role) && <button type="button" className="button secondary" disabled={!file || busy} onClick={async () => { if (!file) return; setBusy(true); setError(''); try { const audit = await postFile('dataset/audit', file); const url = URL.createObjectURL(new Blob([JSON.stringify(audit, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = 'cellscope-research-evaluation.json'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Export failed.'); } finally { setBusy(false); } }}>Download professional evaluation (JSON)</button>}
    </section>
    {shap && <section className="tool-card"><h2>Explain your own trained model and dataset</h2><p>This requires both a compatible breast cancer dataset and its trained model, including its preprocessing and feature order.</p><p>Custom .joblib, .pickle and .keras execution is unavailable on this 512 MB service. These files cannot be safely run inside the account backend. Use the comparison section above with our saved models.</p></section>}
  </section>;
}
export const DatasetUploadPage = ({ user }: { user: User | null }) => <CsvTool user={user} />;
export const ShapExplorerPage = ({ user }: { user: User | null }) => <CsvTool shap user={user} />;
