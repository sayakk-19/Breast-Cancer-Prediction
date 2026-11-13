import { useEffect, useState } from 'react';
import { request } from './api';
import { FileUp } from 'lucide-react';

type Summary = { rows: number; warnings: string[]; models: { name: string; accuracy: number | null; auc: number | null; mean_probability?: number }[] };
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
    <div className="table-scroll"><table><thead><tr><th>{shap ? 'Feature' : 'Model'}</th><th>{shap ? 'Relative SHAP importance' : 'Accuracy'}</th>{!shap && <><th>ROC-AUC</th><th>Average malignancy estimate</th></>}</tr></thead><tbody>{data.models.map(model => <tr key={model.name}><th>{model.name}</th><td>{model.accuracy === null ? 'Valid diagnosis labels required' : `${(model.accuracy * 100).toFixed(1)}%`}</td>{!shap && <><td>{model.auc === null ? '—' : model.auc.toFixed(3)}</td><td>{model.mean_probability == null ? '—' : `${(model.mean_probability * 100).toFixed(1)}%`}</td></>}</tr>)}</tbody></table></div>{shap && <p>Relative importance is normalized within each tree model, then averaged. It does not indicate the direction of an effect or explain the complete ensemble.</p>}</>;
}
function CsvTool({ shap = false }: { shap?: boolean }) {
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<Summary | null>(null);
  useEffect(() => {
    if (!shap) return;
    let active = true; setBusy(true);
    request<Summary>('/dataset/shap').then(data => { if (active) setResult(data); })
      .catch(reason => { if (active) setError(reason.message); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [shap]);
  const run = async () => { if (!file) return; setBusy(true); setError(''); setResult(null); try { setResult(await postFile(shap ? 'dataset/shap' : 'dataset/analyze', file)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Analysis could not be completed.'); } finally { setBusy(false); } };
  const title = shap ? 'SHAP Explorer' : 'Dataset upload & model results';
  const description = shap ? 'Upload a CSV to see which measurements contribute most to each saved model output. Contributions explain a model estimate; they do not establish medical causes.' : 'Upload a CSV with one row per measured specimen. The app checks the 30 required features, explains preparation needs, and compares the saved models. Add diagnosis labels for metrics.';
  return <section className="model-tools"><p className="eyebrow">{shap ? 'MODEL INTERPRETABILITY' : 'MODEL WORKSPACE'}</p><h1>{title}</h1><p>{description}</p>
    <label className="dataset-drop" title="Have your own dataset? Upload a CSV of up to 2,000 rows with the 30 required measurements. Custom model execution is not available in this deployment."><FileUp size={30}/><strong>{file?.name || 'Upload your own CSV dataset'}</strong><span>CSV only · Up to 2,000 data rows · Maximum 5 MB. Use all 30 measurements. Files are processed in memory and not retained.</span><input type="file" accept=".csv,text/csv" disabled={busy} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
    <button className="button primary" disabled={!file || busy} onClick={() => void run()}>{busy ? 'Analyzing…' : shap ? 'Generate explanations' : 'Check & compare models'}</button>
    {error && <p className="dataset-error" role="alert">{error}</p>}{result && <Results data={result} shap={shap}/>}
  </section>;
}
export const DatasetUploadPage = () => <CsvTool />;
export const ShapExplorerPage = () => <CsvTool shap />;
