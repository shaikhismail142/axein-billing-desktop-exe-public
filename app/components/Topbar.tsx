'use client';

import { usePathname, useRouter } from 'next/navigation';

function pageTitle(pathname: string | null) {
  if (!pathname || pathname === '/') return 'Dashboard & Reports';
  const map = [
    { prefix: '/dashboard', label: 'Dashboard & Reports' },
    { prefix: '/products', label: 'Products' },
    { prefix: '/quotations', label: 'Quotations' },
    { prefix: '/invoices', label: 'Invoices' },
    { prefix: '/inventory', label: 'Inventory' },
    { prefix: '/reports', label: 'Dashboard & Reports' },
    { prefix: '/accounting', label: 'Accounting' },
    { prefix: '/profile', label: 'Profile & Settings' },
    { prefix: '/settings', label: 'Profile & Settings' },
    { prefix: '/billing', label: 'Quick Billing' },
  ];
  const hit = map.find((m) => pathname.startsWith(m.prefix));
  return hit?.label ?? 'Workspace';
}

export default function Topbar({ onMenu, collapsed }: { onMenu: () => void; collapsed: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const title = pageTitle(pathname);

  function goBack() {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      router.back();
      return;
    }
    router.push('/dashboard');
  }

  return (
    <header
      className="sticky top-0 z-30"
      style={{
        background: 'color-mix(in oklab, var(--surface-1) 80%, transparent)',
        backdropFilter: 'blur(10px) saturate(160%)',
        borderBottom: '1px solid var(--glass-brd)',
      }}
    >
      <div className="h-14 px-4 flex items-center gap-3">
        {/* Hamburger (mobile drawer + desktop collapse) */}
        <button
          onClick={onMenu}
          className="inline-flex items-center justify-center rounded-xl px-3 py-2"
          style={{ border: '1px solid var(--glass-brd)', background: 'var(--surface-1)', color: 'var(--text)' }}
          aria-label="Toggle sidebar"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M3 6h18M3 12h18M3 18h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <button
          onClick={goBack}
          className="inline-flex items-center justify-center rounded-xl px-3 py-2"
          style={{ border: '1px solid var(--glass-brd)', background: 'var(--surface-1)', color: 'var(--text)' }}
          aria-label="Go back"
          title="Go back"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="flex flex-col">
          <div className="text-[11px] uppercase tracking-[0.24em]" style={{ color: 'var(--muted)' }}>
            AxEin Billing
          </div>
          <div className="font-semibold" style={{ color: 'var(--text)' }}>
            {title}
          </div>
        </div>
        <div className="ml-auto text-xs" style={{ color: 'var(--muted)' }}>IST</div>
      </div>
    </header>
  );
}
