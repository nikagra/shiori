import { useEffect, useState } from 'react';
import { Home } from './screens/Home';
import { Import } from './screens/Import';
import { Triage } from './screens/Triage';
import { Pages } from './screens/Pages';
import { PageView } from './screens/PageView';
import { PagePicker } from './screens/PagePicker';
import { Review } from './screens/Review';
import { Lists } from './screens/Lists';
import { ListWords } from './screens/ListWords';
import { Settings } from './screens/Settings';
import { AddWord } from './screens/AddWord';

// Hash routes: #/, #/review, #/pages, #/pages/3, #/pages/new (pick the words; #/pages/new/2 from list 2), #/lists, #/lists/2 (its words), #/check, #/settings,
// #/settings/backup (scrolled to that section), #/settings/import, #/add (a word from the dictionary; #/add/2 into list 2)

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
  { href: '#/settings', label: 'Settings', match: 'settings' },
];

export function App() {
  const route = useHashRoute();
  // Old #/import links open Settings › Import.
  const [section, id, sub] = route[0] === 'import' ? ['settings', 'import'] : route;

  let screen;
  switch (section) {
    case 'review':
      screen = <Review />;
      break;
    case 'pages':
      screen =
        id === 'new' ? <PagePicker key={sub} listId={sub ? Number(sub) : null} /> : id ? <PageView key={id} id={Number(id)} /> : <Pages />;
      break;
    case 'lists':
      screen = id ? <ListWords key={id} id={Number(id)} /> : <Lists />;
      break;
    case 'add':
      screen = <AddWord key={id} listId={id ? Number(id) : null} />;
      break;
    case 'check':
      screen = <Triage />;
      break;
    case 'settings':
      screen = id === 'import' ? <Import /> : <Settings key={id} scrollTo={id} />;
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
