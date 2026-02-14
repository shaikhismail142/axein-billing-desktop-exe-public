import Link from "next/link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const cards = [
  {
    href: "/profile/settings",
    title: "Settings",
    desc: "Business profile, license key activation, invoice defaults, and backup/restore controls.",
  },
  {
    href: "/profile/users",
    title: "User Access",
    desc: "Approve pending users, assign roles, and review RBAC access visibility.",
  },
  {
    href: "/profile/network",
    title: "Network (LAN)",
    desc: "Configure host/client mode, generate pairing codes, and manage connected PCs.",
  },
  {
    href: "/profile/logs",
    title: "Audit Logs",
    desc: "Review activity history (user changes, access updates, licensing, LAN) and export a support bundle.",
  },
];

export default function ProfilePage() {
  return (
    <div className="container">
      <div className="card" style={{ padding: 16 }}>
        <h1 style={{ margin: 0 }}>Profile</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          Manage settings, users, access approvals, and diagnostic logs.
        </p>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
          gap: 12,
          marginTop: 12,
        }}
      >
        {cards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="card"
            style={{ display: "block", padding: 14, textDecoration: "none" }}
          >
            <h3 style={{ margin: 0 }}>{c.title}</h3>
            <p className="muted" style={{ marginTop: 8 }}>{c.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
