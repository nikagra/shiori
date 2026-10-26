import { useEffect, useState } from 'react';
import { Home } from './screens/Home';
import { Import } from './screens/Import';
import { Triage } from './screens/Triage';
import { Pages } from './screens/Pages';
import { PageView } from './screens/PageView';
import { Review } from './screens/Review';
import { Lists } from './screens/Lists';

// Hash routes: #/, #/review, #/pages, #/pages/3, #/lists, #/check, #/check/2, #/import

function useHashRoute(): string[] {
  const read = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const onChange = () => {
      setRoute(read());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

const NAV = [
  { href: '#/', label: 'Home', match: '' },
  { href: '#/review', label: 'Review', match: 'review' },
  { href: '#/pages', label: 'Pages', match: 'pages' },
  { href: '#/lists', label: 'Lists', match: 'lists' },
  { href: '#/check', label: 'Check', match: 'check' },
  { href: '#/import', label: 'Import', match: 'import' },
];

export function App() {
  const route = useHashRoute();
  const [section, id] = route;

  let screen;
  switch (section) {
    case 'review':
      screen = <Review />;
      break;
    case 'pages':
      screen = id ? <PageView key={id} id={Number(id)} /> : <Pages />;
      break;
    case 'lists':
      screen = <Lists />;
      break;
    case 'check':
      screen = <Triage key={id ?? 'all'} listId={id ? Number(id) : null} />;
      break;
    case 'import':
      screen = <Import />;
      break;
    default:
      screen = <Home />;
  }

  return (
    <div className="app">
      <header className="topbar">
        <a href="#/" className="brand">
          <span lang="ja" className="brand__mark">
            栞
          </span>
          Shiori
        </a>
      </header>
      <main className="main">{screen}</main>
      <nav className="tabbar" aria-label="Main">
        {NAV.map((n) => (
          <a key={n.href} href={n.href} className={`tabbar__item${(section ?? '') === n.match ? ' tabbar__item--active' : ''}`}>
            {n.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
