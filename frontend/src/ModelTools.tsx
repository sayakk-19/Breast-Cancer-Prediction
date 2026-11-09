import { useState } from 'react';
import { FileUp, Sparkles } from 'lucide-react';

type Summary = { rows: number; warnings: string[]; models: { name: string; accuracy: number | null; auc: number | null }[] };
const postFile = async (path: string, file: File): Promise<Summary> => {
  const form = new FormData(); form.append('file', file);
  const response = await fetch('/api/v1/' + path, { method: 'POST', credentials: 'include', body: form });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.detail?.message || body?.detail || 'Analysis could not be completed.');
  return body;
};
function Results({ data }: { data: Summary }) {
  return <><h2>{data.rows} rows ready for review</h2>{data.warnings.map(message => <p className="dataset-warning" key={message}>{message}</p>)}
    <div className="table-scroll"><table><thead><tr><th>Model</th><th>Accuracy</th><th>ROC-AUC</th></tr></thead><tbody>{data.models.map(model => <tr key={model.name}><th>{model.name}</th><td>{model.accuracy === null ? 'Diagnosis column required' : `${(model.accuracy * 100).toFixed(1)}%`}</td><td>{model.auc === null ? '—' : model.auc.toFixed(3)}</td></tr>)}</tbody></table></div></>;
}
function CsvTool({ shap = false }: { shap?: boolean }) {
  const [file, setFile] = useState<File | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState<Summary | null>(null);
  const run = async () => { if (!file) return; setBusy(true); setError(''); setResult(null); try { setResult(await postFile(shap ? 'dataset/shap' : 'dataset/analyze', file)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Analysis could not be completed.'); } finally { setBusy(false); } };
  const title = shap ? 'SHAP Explorer' : 'Dataset upload & model results';
  const description = shap ? 'Upload a CSV to see which measurements contribute most to each saved model output. Contributions explain a model estimate; they do not establish medical causes.' : 'Upload a CSV with one row per measured specimen. The app checks the 30 required features, explains preparation needs, and compares the saved models. Add diagnosis labels for metrics.';
  return <section className="model-tools"><p className="eyebrow">{shap ? 'MODEL INTERPRETABILITY' : 'MODEL WORKSPACE'}</p><h1>{title}</h1><p>{description}</p>
    <label className="dataset-drop"><FileUp size={30}/><strong>{file?.name || 'Choose a CSV dataset'}</strong><span>One row per specimen. The file is processed in memory and is not retained.</span><input type="file" accept=".csv,text/csv" disabled={busy} onChange={event => setFile(event.target.files?.[0] ?? null)} /></label>
    <button className="button primary" disabled={!file || busy} onClick={() => void run()}>{busy ? 'Analyzing…' : shap ? 'Generate explanations' : 'Check & compare models'}</button>
    {error && <p className="dataset-error" role="alert">{error}</p>}{result && <Results data={result}/>}
  </section>;
}
export const DatasetUploadPage = () => <CsvTool />;
export const ShapExplorerPage = () => <CsvTool shap />;
