import { useState } from 'react';
import { Check, Eye, EyeOff, LockKeyhole } from 'lucide-react';

export default function AuthFields({ mode, busy }: { mode: 'login' | 'register'; busy: boolean }) {
  const [visible, setVisible] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [capsLock, setCapsLock] = useState(false);
  const register = mode === 'register';
  const mismatch = !!confirmation && confirmation !== password;
  return <>
    <label htmlFor="auth-username">Username<input id="auth-username" name="username" required minLength={3} maxLength={40} pattern="[A-Za-z0-9_.\-]+" autoComplete="username" autoCapitalize="none" spellCheck={false} placeholder={register ? 'Choose a username' : 'Enter your username'} disabled={busy} aria-describedby={register ? 'username-guidance' : undefined} />{register && <small id="username-guidance">3–40 letters, numbers, periods, underscores, or hyphens.</small>}</label>
    <div className="password-field"><label htmlFor="auth-password">Password</label><div className="password-input"><input id="auth-password" name="password" type={visible ? 'text' : 'password'} required minLength={register ? 12 : 1} maxLength={128} autoComplete={register ? 'new-password' : 'current-password'} placeholder={register ? 'Create a password' : 'Enter your password'} disabled={busy} value={password} onChange={event => setPassword(event.target.value)} onKeyUp={event => setCapsLock(event.getModifierState('CapsLock'))} onBlur={() => setCapsLock(false)} aria-describedby={register ? 'password-guidance' : undefined} /><button type="button" className="icon-button" aria-label={visible ? 'Hide password' : 'Show password'} aria-pressed={visible} onClick={() => setVisible(previous => !previous)} disabled={busy}>{visible ? <EyeOff size={18} /> : <Eye size={18} />}</button></div>{register && <small id="password-guidance" className={password.length >= 12 ? 'requirement-met' : ''}>{password.length >= 12 ? <Check size={14} /> : <LockKeyhole size={13} />} Use at least 12 characters and a unique password.</small>}{capsLock && <small className="field-warning" role="status">Caps Lock is on.</small>}</div>
    {register && <label htmlFor="auth-confirm">Confirm password<input id="auth-confirm" name="confirm_password" type={visible ? 'text' : 'password'} required maxLength={128} autoComplete="new-password" placeholder="Enter the password again" value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={busy} aria-invalid={mismatch} aria-describedby={mismatch ? 'confirmation-error' : undefined} />{mismatch && <small className="field-warning" id="confirmation-error">Your passwords do not match yet.</small>}</label>}
  </>;
}
