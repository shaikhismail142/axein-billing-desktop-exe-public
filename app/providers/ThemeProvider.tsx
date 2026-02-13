'use client';

import React, { createContext, useContext, useLayoutEffect, useMemo, useState, useCallback, useRef } from 'react';

type Theme = 'light' | 'dark';
type Mode = 'system' | Theme;
type ColorTheme = 'blue' | 'green' | 'amber' | 'rose';

type Ctx = {
  theme: Theme;
  resolvedTheme: Theme;
  mode: Mode;
  setTheme: (m: Mode) => void;
  toggle: () => void;
};

const ThemeCtx = createContext<Ctx | null>(null);

const LS_MODE_KEY = 'axein_theme_mode';
const LS_OLD_KEY = 'axein_theme';
const LS_COLOR_THEME_KEY = 'axein_color_theme';

function readColorTheme(): ColorTheme {
  try {
    const raw = localStorage.getItem(LS_COLOR_THEME_KEY);
    if (raw === 'green' || raw === 'amber' || raw === 'rose' || raw === 'blue') return raw;
  } catch {
    // ignore
  }
  return 'blue';
}

function applyColorTheme(theme: ColorTheme) {
  document.documentElement.setAttribute('data-color-theme', theme);
}

function readStoredMode(): Mode {
  try {
    const raw = localStorage.getItem(LS_MODE_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
    const legacy = localStorage.getItem(LS_OLD_KEY);
    if (legacy === 'light' || legacy === 'dark') return legacy;
  } catch {
    // ignore
  }
  return 'light';
}

function resolveMode(mode: Mode): Theme {
  if (mode === 'system' && typeof window !== 'undefined') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode === 'dark' ? 'dark' : 'light';
}

function ensureColorSchemeMeta() {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'color-scheme');
    document.head.appendChild(meta);
  }
  return meta;
}

function applyResolvedTheme(theme: Theme): void {
  const html = document.documentElement;
  html.classList.toggle('dark', theme === 'dark');
  html.setAttribute('data-theme', theme);
  const meta = ensureColorSchemeMeta();
  meta.setAttribute('content', theme === 'dark' ? 'dark light' : 'light dark');
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>('system');
  const [resolvedTheme, setResolvedTheme] = useState<Theme>('light');
  const modeRef = useRef<Mode>('system');

  useLayoutEffect(() => {
    const initialMode = readStoredMode();
    const initialResolved = resolveMode(initialMode);
    modeRef.current = initialMode;
    setMode(initialMode);
    setResolvedTheme(initialResolved);
    applyResolvedTheme(initialResolved);
    applyColorTheme(readColorTheme());

    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onMediaChange = () => {
      if (modeRef.current !== 'system') return;
      const next = resolveMode('system');
      setResolvedTheme(next);
      applyResolvedTheme(next);
    };
    media.addEventListener?.('change', onMediaChange);
    return () => {
      media.removeEventListener?.('change', onMediaChange);
    };
  }, []);

  const setTheme = useCallback((nextMode: Mode) => {
    modeRef.current = nextMode;
    setMode(nextMode);
    const nextResolved = resolveMode(nextMode);
    setResolvedTheme(nextResolved);
    applyResolvedTheme(nextResolved);
    try {
      localStorage.setItem(LS_MODE_KEY, nextMode);
      localStorage.removeItem(LS_OLD_KEY);
    } catch {
      // ignore
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
  }, [resolvedTheme, setTheme]);

  const value = useMemo<Ctx>(
    () => ({
      theme: resolvedTheme,
      resolvedTheme,
      mode,
      setTheme,
      toggle,
    }),
    [resolvedTheme, mode, setTheme, toggle]
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
