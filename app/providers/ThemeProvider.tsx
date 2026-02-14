'use client';

import React, { createContext, useContext, useLayoutEffect, useMemo, useState, useCallback, useRef } from 'react';

type Theme = 'light' | 'dark';
type Mode = 'system' | Theme;
type ColorTheme = 'blue' | 'green' | 'amber' | 'rose' | 'purple' | 'slate' | 'orange' | 'console';

type Ctx = {
  theme: Theme;
  resolvedTheme: Theme;
  mode: Mode;
  setTheme: (m: Mode) => void;
  toggle: () => void;
  uiScale: number;
  setUiScale: (n: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
};

const ThemeCtx = createContext<Ctx | null>(null);

const LS_MODE_KEY = 'axein_theme_mode';
const LS_OLD_KEY = 'axein_theme';
const LS_COLOR_THEME_KEY = 'axein_color_theme';
const LS_UI_SCALE_KEY = 'axein_ui_scale';

function readColorTheme(): ColorTheme {
  try {
    const raw = localStorage.getItem(LS_COLOR_THEME_KEY);
    if (raw === 'green' || raw === 'amber' || raw === 'rose' || raw === 'blue') return raw;
    if (raw === 'purple' || raw === 'slate' || raw === 'orange' || raw === 'console') return raw;
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

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

function readUiScale(): number {
  try {
    const raw = localStorage.getItem(LS_UI_SCALE_KEY);
    const n = Number(raw);
    if (Number.isFinite(n)) return clamp(n, 0.85, 1.35);
  } catch {
    // ignore
  }
  return 1;
}

function applyUiScale(scale: number) {
  document.documentElement.style.setProperty('--ui-scale', String(scale));
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>('system');
  const [resolvedTheme, setResolvedTheme] = useState<Theme>('light');
  const modeRef = useRef<Mode>('system');
  const [uiScale, setUiScaleState] = useState<number>(1);
  const uiScaleRef = useRef<number>(1);

  useLayoutEffect(() => {
    const initialMode = readStoredMode();
    const initialResolved = resolveMode(initialMode);
    modeRef.current = initialMode;
    setMode(initialMode);
    setResolvedTheme(initialResolved);
    applyResolvedTheme(initialResolved);
    applyColorTheme(readColorTheme());
    const initialScale = readUiScale();
    uiScaleRef.current = initialScale;
    setUiScaleState(initialScale);
    applyUiScale(initialScale);

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

  const setUiScale = useCallback((next: number) => {
    const clamped = clamp(Math.round(next * 100) / 100, 0.85, 1.35);
    uiScaleRef.current = clamped;
    setUiScaleState(clamped);
    applyUiScale(clamped);
    try {
      localStorage.setItem(LS_UI_SCALE_KEY, String(clamped));
    } catch {
      // ignore
    }
  }, []);

  const zoomIn = useCallback(() => setUiScale(uiScaleRef.current + 0.1), [setUiScale]);
  const zoomOut = useCallback(() => setUiScale(uiScaleRef.current - 0.1), [setUiScale]);
  const resetZoom = useCallback(() => setUiScale(1), [setUiScale]);

  const value = useMemo<Ctx>(
    () => ({
      theme: resolvedTheme,
      resolvedTheme,
      mode,
      setTheme,
      toggle,
      uiScale,
      setUiScale,
      zoomIn,
      zoomOut,
      resetZoom,
    }),
    [resolvedTheme, mode, setTheme, toggle, uiScale, setUiScale, zoomIn, zoomOut, resetZoom]
  );

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
