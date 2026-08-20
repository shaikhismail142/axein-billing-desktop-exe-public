'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Boxes, FileClock, FileText, Gauge, PackageSearch, ReceiptText, Settings2, ShieldCheck, ShoppingCart, TrendingUp, Users, Warehouse } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type SidebarProps = { open?: boolean; onClose?: () => void; collapsed?: boolean };

type NavItem = {
  key: string;
  href: string;
  label: string;
};

const FALLBACK_NAV: NavItem[] = [
  { key: 'dashboard', href: '/dashboard', label: 'Dashboard & Reports' },
  { key: 'billing', href: '/billing', label: 'Quick Billing' },
  { key: 'invoices', href: '/invoices', label: 'Invoices' },
  { key: 'quotations', href: '/quotations', label: 'Quotations' },
  { key: 'products', href: '/products', label: 'Products' },
  { key: 'inventory', href: '/inventory/low-stock', label: 'Low Stock' },
  { key: 'purchases', href: '/inventory/purchases', label: 'Purchases' },
  { key: 'accounting', href: '/accounting', label: 'Accounting' },
  { key: 'profile', href: '/profile', label: 'Profile' },
];

const NAV_ICONS: Record<string, LucideIcon> = {
  dashboard: Gauge,
  billing: ReceiptText,
  invoices: FileText,
  quotations: FileText,
  products: PackageSearch,
  inventory: Warehouse,
  purchases: ShoppingCart,
  accounting: TrendingUp,
  profile: Settings2,
};

const ADMIN_NAV = [
  { key: 'settings', href: '/profile/settings', label: 'Business Settings', icon: Settings2, permissions: ['perm.settings.manage'] },
  { key: 'users', href: '/profile/users', label: 'Users & Roles', icon: Users, permissions: ['perm.users.manage', 'perm.users.approve', 'perm.roles.manage'] },
  { key: 'audit', href: '/profile/logs', label: 'Audit Logs', icon: FileClock, permissions: ['perm.audit.view', 'perm.audit.export'] },
];

export default function Sidebar({ open = false, onClose, collapsed = false }: SidebarProps) {
  const pathname = usePathname();
  const [nav, setNav] = useState<NavItem[]>(FALLBACK_NAV);
  const [adminNav, setAdminNav] = useState<typeof ADMIN_NAV>([]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch('/api/profile/navigation', { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !Array.isArray(data?.items)) return;
        const items = data.items
          .map((item: any) => ({
            key: String(item?.key || "").trim(),
            href: String(item?.href || "").trim(),
            label: String(item?.label || "").trim(),
          }))
          .filter((item: NavItem) => item.key && item.href && item.label);
        if (active && items.length > 0) setNav(items);
      } catch {
        // Keep fallback navigation when profile API is unavailable.
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    fetch('/api/profile/access', { cache: 'no-store' })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (!active || !data) return;
        const permissions = new Set(Array.isArray(data.permissions) ? data.permissions.map(String) : []);
        const roles = new Set(Array.isArray(data.roles) ? data.roles.map((role: unknown) => String(role).toLowerCase()) : []);
        const elevated = roles.has('owner') || roles.has('admin') || roles.has('platform_admin');
        setAdminNav(ADMIN_NAV.filter((item) => elevated || item.permissions.some((permission) => permissions.has(permission))));
      })
      .catch(() => setAdminNav([]));
    return () => { active = false; };
  }, []);

  const Nav = (
    <nav className={`app-sidebar-nav ${collapsed ? "is-collapsed" : ""}`}>
      <Link href="/dashboard" className="app-sidebar-brand" title="AxEin Billing">
        <span className="app-sidebar-logo">AB</span>
        {!collapsed && <span><strong>AxEin</strong><small>Billing workspace</small></span>}
      </Link>
      {nav.map((item) => {
        const active =
          item.href === '/dashboard'
            ? pathname === '/dashboard'
            : pathname === item.href || pathname.startsWith(item.href + '/');
        const Icon = NAV_ICONS[item.key] || Boxes;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onClose}
            title={item.label}
            className={[
              "app-sidebar-link group",
              collapsed ? "justify-center" : "",
            ].join(" ")}
            style={{
              color: 'var(--text)',
              border: `1px solid ${active ? 'color-mix(in oklab, var(--primary) 35%, transparent)' : 'transparent'}`,
              background: active
                ? 'color-mix(in oklab, var(--primary) 18%, transparent)'
                : 'transparent'
            }}
            aria-current={active ? "page" : undefined}
          >
            <span className="app-sidebar-icon" aria-hidden><Icon size={18} strokeWidth={1.8} /></span>
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
      {adminNav.length > 0 && (
        <div className="app-sidebar-admin">
          {!collapsed && <div className="app-sidebar-section-label"><ShieldCheck size={13} /> Administration</div>}
          {adminNav.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + '/');
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                title={item.label}
                className={`app-sidebar-link app-sidebar-admin-link ${collapsed ? 'justify-center' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <span className="app-sidebar-icon" aria-hidden><Icon size={18} strokeWidth={1.8} /></span>
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </div>
      )}
    </nav>
  );

  const CloseIcon = (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );

  return (
    <>
      {/* Mobile drawer */}
      <div
        aria-hidden={!open}
        className={[
          'fixed inset-0 z-40 sm:hidden transition',
          open ? 'pointer-events-auto' : 'pointer-events-none',
        ].join(' ')}
      >
        {/* Backdrop */}
        <div
          onClick={onClose}
          className={[
            'absolute inset-0 transition-opacity',
            open ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
          style={{ background: 'rgba(0,0,0,.3)', backdropFilter: 'blur(1px)' }}
        />
        {/* Panel */}
        <aside
          className={[
            'absolute left-0 top-0 h-full w-64',
            'transition-transform',
            open ? 'translate-x-0' : '-translate-x-full',
          ].join(' ')}
          style={{
            borderRight: '1px solid var(--glass-brd)',
            background: 'var(--glass-bg)',
            backdropFilter: 'blur(10px)',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            className="m-3 inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-sm"
            style={{ border: '1px solid var(--glass-brd)', background: 'var(--surface-1)' }}
          >
            {CloseIcon}
            Close
          </button>
          {Nav}
        </aside>
      </div>

      {/* Desktop / tablet (sticky) */}
      <aside
          className={`app-sidebar sticky top-0 hidden h-[100dvh] shrink-0 sm:block transition-[width] duration-200 ${collapsed ? "w-20" : "w-64"}`}
        style={{
          borderRight: '1px solid var(--glass-brd)',
          background: 'var(--glass-bg)',
          backdropFilter: 'blur(8px)',
          position: 'sticky'
        }}
      >
        <div
          className="pointer-events-none absolute right-0 top-0 h-full w-px"
          style={{
            background: 'linear-gradient(to bottom, transparent, color-mix(in oklab, var(--text) 20%, transparent), transparent)',
            opacity: .35
          }}
        />
        {Nav}
      </aside>
    </>
  );
}
