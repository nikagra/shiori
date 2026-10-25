import { useCallback, useState } from 'react';

// Per-device preferences, kept in localStorage.

export interface Settings {
  autoPlay: boolean;
  listenFirst: boolean;
  pageSize: number;
}

const DEFAULTS: Settings = { autoPlay: true, listenFirst: false, pageSize: 12 };
const KEY = 'shiori.settings';

function load(): Settings {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>) };
  } catch {
    return DEFAULTS;
  }
}

export function useSettings(): [Settings, (patch: Partial<Settings>) => void] {
  const [settings, setSettings] = useState(load);
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // Private mode: keep the setting for this session only.
      }
      return next;
    });
  }, []);
  return [settings, update];
}
