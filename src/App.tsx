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
import { Dictionary, DictEntryPage } from './screens/Dictionary';
import { listParam, readHash } from './nav';
import { Practice } from './screens/Practice';

// Hash routes: #/, #/review, #/pages, #/pages/3, #/pages/new (pick the words; #/pages/new/2 from list 2), #/lists, #/lists/2 (its words; #/lists/2/leeches its leeches), #/check, #/settings,
// #/practise (pick learned pages to practise; #/practise/3,5 practises those pages),
// #/settings/backup, #/settings/grading (scrolled to that section), #/settings/import,
// #/dict?q=食べた&list=2 (the dictionary: what you searched for, the list to add to), #/dict/1358280 (an entry, with the same ?q and ?list),
// #/lists/2?word=15 (a list with that word open); old #/add and #/add/2 links open the dictionary.

function useHashRoute() {
  const read = () => readHash();
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
  { href: '#/dict', label: 'Dictionary', match: 'dict' },
  { href: '#/settings', label: 'Settings', match: 'settings' },
];

export function App() {
  const { parts, params } = useHashRoute();
  // Old #/import links open Settings › Import; old #/add links open the dictionary.
  const [section, id, sub] = parts[0] === 'import' ? ['settings', 'import'] : parts[0] === 'add' ? ['dict'] : parts;
  const list = parts[0] === 'add' ? (Number(parts[1]) > 0 ? Number(parts[1]) : null) : listParam(params);

  let screen;
  switch (section) {
    case 'review':
      screen = <Review />;
      break;
    case 'pages':
      screen =
        id === 'new' ? <PagePicker key={sub} listId={sub ? Number(sub) : null} /> : id ? <PageView key={id} id={Number(id)} /> : <Pages />;
      break;
    case 'practise':
      screen = (
        <Practice
          key={id ?? ''}
          ids={(id ?? '')
            .split(',')
            .map(Number)
            .filter((n) => Number.isInteger(n) && n > 0)}
        />
      );
      break;
    case 'lists':
      screen = id ? (
        <ListWords key={`${id}/${sub ?? ''}/${params.get('word') ?? ''}`} id={Number(id)} leeches={sub === 'leeches'} focus={Number(params.get('word')) || null} />
      ) : (
        <Lists />
      );
      break;
    case 'dict': {
      const q = params.get('q') ?? '';
      screen = id ? <DictEntryPage key={id} seq={Number(id)} ctx={{ q, list }} /> : <Dictionary key={`${q}/${list ?? ''}`} q={q} list={list} />;
      break;
    }
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
          <a key={n.href} href={n.href} className={`tabbar__item${(section === 'practise' ? 'pages' : (section ?? '')) === n.match ? ' tabbar__item--active' : ''}`}>
            {n.label}
          </a>
        ))}
      </nav>
    </div>
  );
}
