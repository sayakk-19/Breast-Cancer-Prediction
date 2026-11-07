import { ArrowUpRight, Github, HeartHandshake, Instagram, Linkedin } from 'lucide-react';

const profiles = [
  { name: 'GitHub', url: import.meta.env.VITE_GITHUB_URL || '', icon: Github },
  { name: 'LinkedIn', url: import.meta.env.VITE_LINKEDIN_URL || '', icon: Linkedin },
  { name: 'Instagram', url: import.meta.env.VITE_INSTAGRAM_URL || '', icon: Instagram },
];

function profileUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return undefined; }
}

export default function SiteFooter({ navigate, openPrivacy }: {
  navigate: (page: 'overview' | 'library' | 'about') => void;
  openPrivacy: () => void;
}) {
  const xUrl = profileUrl(import.meta.env.VITE_X_URL || '');
  const xIcon = <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3l-4.9-7.5L5.5 22H2.3l8.2-9.5L.8 2h6.5l4.5 6.9L18.9 2Zm-1.1 18h1.7L6.4 3.9H4.6L17.8 20Z" /></svg>;
  return <footer className="site-footer">
    <div className="footer-grid">
      <div className="footer-brand-column">
        <button className="footer-brand" onClick={() => navigate('overview')} aria-label="Breast Cancer Prediction home"><HeartHandshake size={30} strokeWidth={1.6} /><span>Breast Cancer<strong>Prediction & education</strong></span></button>
        <p>Clearer information. Considered research. A shared space for people who want to understand breast health.</p>
        <div className="social-links" aria-label="Social profiles">
          {profiles.map(({ name, url, icon: Icon }) => {
            const href = profileUrl(url);
            return href ? <a key={name} className="social-link" href={href} target="_blank" rel="noopener noreferrer" aria-label={`${name} (opens in a new tab)`}><Icon size={19} /></a>
              : <button key={name} type="button" className="social-link unavailable" aria-disabled="true" aria-label={`${name} — link coming soon`} title={`${name} · coming soon`}><Icon size={19} /><span className="social-tooltip">Coming soon</span></button>;
          })}
          {xUrl ? <a className="social-link" href={xUrl} target="_blank" rel="noopener noreferrer" aria-label="X (opens in a new tab)">{xIcon}</a>
            : <button type="button" className="social-link unavailable" aria-disabled="true" aria-label="X — link coming soon" title="X · coming soon">{xIcon}<span className="social-tooltip">Coming soon</span></button>}
        </div>
      </div>
      <nav className="footer-links" aria-label="Explore the project"><h2>Explore</h2><button onClick={() => navigate('overview')}>Home</button><button onClick={() => navigate('library')}>Learning library</button><button onClick={() => navigate('about')}>About the project</button><button onClick={() => navigate('about')}>Roles & access</button></nav>
      <nav className="footer-links" aria-label="Useful external resources"><h2>Useful resources</h2><a href="https://www.cancer.gov/types/breast" target="_blank" rel="noopener noreferrer">National Cancer Institute <ArrowUpRight size={14} /></a><a href="https://www.who.int/news-room/fact-sheets/detail/breast-cancer" target="_blank" rel="noopener noreferrer">WHO: breast cancer <ArrowUpRight size={14} /></a><a href="https://www.cancer.gov/publications/dictionaries/cancer-terms" target="_blank" rel="noopener noreferrer">Cancer terms explained <ArrowUpRight size={14} /></a></nav>
      <div className="footer-purpose"><h2>Knowledge, with care</h2><p>Educational information supports understanding and conversations with qualified professionals. It does not provide a personal diagnosis.</p><button onClick={openPrivacy}>How your data is handled <ArrowUpRight size={14} /></button></div>
    </div>
    <div className="footer-bottom"><span>© {new Date().getFullYear()} Breast Cancer Prediction</span><div><button onClick={openPrivacy}>Privacy & data</button><a href="https://cellscope-nu.vercel.app/">Visit the live website <ArrowUpRight size={13} /></a><a href="#main-content">Back to top ↑</a></div></div>
  </footer>;
}
