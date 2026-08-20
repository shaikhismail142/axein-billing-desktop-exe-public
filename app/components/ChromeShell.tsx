"use client";

import { usePathname } from "next/navigation";
import SiteFooter from "@/components/SiteFooter";
import ClientShell from "@/components/ClientShell";
import LicenseBanner from "@/app/_components/LicenseBanner";

const PRINT_ROUTE_PREFIXES = [
  "/login",
  "/signup",
  "/reports/tax/print",
  "/api/invoices",
  "/api/quotations",
  "/staff/keygen",
];

function shouldHideChrome(pathname: string | null) {
  if (!pathname) return false;
  return PRINT_ROUTE_PREFIXES.some((p) => pathname.startsWith(p));
}

export default function ChromeShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const hideChrome = shouldHideChrome(pathname);

  if (hideChrome) {
    return (
      <div className="min-h-dvh" style={{ background: pathname?.startsWith("/login") ? "var(--bg)" : "white", color: pathname?.startsWith("/login") ? "var(--text)" : "#0f172a" }}>
        <main id="main" className={pathname?.startsWith("/login") ? "min-h-dvh" : "p-6"}>
          {children}
        </main>
      </div>
    );
  }

  return (
    <div className="app-shell min-h-dvh flex flex-col">
      {/* License status banner */}
      <LicenseBanner />

      {/* Main */}
      <ClientShell>
        {children}
      </ClientShell>

      {/* Footer */}
      <SiteFooter />
    </div>
  );
}
