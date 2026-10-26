import { useCallback, useState } from 'react';

// Per-device preferences, kept in localStorage. Furigana prefs describe you,
// not the device, so they live on the server instead (see furigana.ts).

export interface Settings {
  autoPlay: boolean;
  listenFirst: boolean;
  pageSize: number;
  /** The list the check pass takes words from; null for all lists. */
  checkList: number | null;
}

const DEFAULTS: Settings = {
  autoPlay: true,
  listenFirst: false,
  pageSize: 12,
  checkList: null,
};
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
