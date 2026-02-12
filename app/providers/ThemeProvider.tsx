'use client';

import React, { createContext, useContext, useLayoutEffect, useMemo, useState, useCallback } from 'react';

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

function ensureColorSchemeMeta() {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'color-scheme');
    document.head.appendChild(meta);
  }
  return meta;
}

function applyResolvedTheme(): void {
  const html = document.documentElement;
  html.classList.remove('dark');
  html.setAttribute('data-theme', 'light');
  const meta = ensureColorSchemeMeta();
  meta.setAttribute('content', 'light');
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>('light');
  const [resolvedTheme, setResolvedTheme] = useState<Theme>('light');

  useLayoutEffect(() => {
    applyResolvedTheme();
    applyColorTheme(readColorTheme());
    setMode('light');
    setResolvedTheme('light');
  }, []);

  const setTheme = useCallback((_: Mode) => {
    try {
      localStorage.setItem(LS_MODE_KEY, 'light');
      localStorage.removeItem(LS_OLD_KEY);
    } catch {
      // ignore
    }
    applyResolvedTheme();
    setMode('light');
    setResolvedTheme('light');
  }, []);

  const toggle = useCallback(() => {
    setTheme('light');
  }, [setTheme]);

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
