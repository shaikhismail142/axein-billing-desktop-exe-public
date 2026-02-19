export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

import Link from "next/link";
import { ensureActivated } from "@/app/lib/activation-guard";
import { getServerRequestContext } from "@/app/lib/server-request";

type ProductRow = {
  id: number;
  name: string;
  price?: number;
  stock_qty?: number;
  low_stock_threshold?: number;
};

type ApiResponse = {
  items: ProductRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
};

function inr(n: number) {
  return `INR (Rs/-) ${Number(n || 0).toFixed(2)}`;
}

async function fetchLowStock(
  ctx: ReturnType<typeof getServerRequestContext>,
  q: string,
  page: number
): Promise<{ data: ApiResponse | null; error: string }> {
  const qs = new URLSearchParams({
    low: "1",
    page: String(page),
    perPage: "20",
  });
  if (q) qs.set("q", q);

  try {
    const res = await fetch(`${ctx.baseUrl}/api/products?${qs.toString()}`, {
      cache: "no-store",
      headers: ctx.authHeaders,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        data: null,
        error: `Low-stock API failed (${res.status}): ${text || res.statusText}`,
      };
    }
    const json = (await res.json().catch(() => null)) as ApiResponse | null;
    if (!json || !Array.isArray(json.items)) {
      return { data: null, error: "Unexpected low-stock API response" };
    }
    return { data: json, error: "" };
  } catch {
    return { data: null, error: "Could not reach low-stock API" };
  }
}

export default async function LowStockPage({
  searchParams,
}: {
  searchParams: { q?: string; page?: string; updated?: string; error?: string };
}) {
  await ensureActivated(true);
  const ctx = getServerRequestContext();

  const q = String(searchParams?.q || "").trim();
  const page = Math.max(1, Number(searchParams?.page || 1));
  const updated = String(searchParams?.updated || "").trim();
  const saveError = String(searchParams?.error || "").trim();

  const { data, error } = await fetchLowStock(ctx, q, page);
  const items = data?.items || [];
  const total = Number(data?.total || 0);
  const totalPages = Math.max(1, Number(data?.totalPages || 1));
  const currentPage = Math.max(1, Number(data?.page || page));

  const returnTo = `/inventory/low-stock?${new URLSearchParams({ q, page: String(currentPage) }).toString()}`;

  const pageHref = (p: number) =>
    `/inventory/low-stock?${new URLSearchParams({ q, page: String(Math.max(1, p)) }).toString()}`;

  return (
    <div>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ margin: 0 }}>Low Stock</h1>
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
              Products where stock is at or below configured threshold
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: 12 }}>
              {total} products
            </span>
            <Link className="btn-outline px-3 py-2" href={pageHref(currentPage)}>
              Refresh
            </Link>
            <Link className="btn-outline px-3 py-2" href="/inventory/settings">
              Inventory Settings
            </Link>
          </div>
        </div>

        <form method="get" action="/inventory/low-stock" className="no-print mt-3">
          <div className="flex gap-2">
            <input
              type="text"
              name="q"
              defaultValue={q}
              placeholder="Search by name, category, SKU…"
              className="w-[320px]"
            />
            <button className="btn-outline px-3 py-2">Search</button>
            {q && (
              <a href="/inventory/low-stock" className="glass-btn px-3 py-2 rounded-2xl">
                Clear
              </a>
            )}
          </div>
        </form>

        {(updated || saveError) && (
          <div
            className="mt-3 rounded-xl border px-3 py-2 text-sm"
            style={{ background: saveError ? "rgba(244,63,94,0.08)" : "rgba(16,185,129,0.08)" }}
          >
            {saveError ? "Could not save changes. Please try again." : "Changes saved successfully."}
          </div>
        )}

        {error ? (
          <div
            className="mt-3 rounded-xl border px-3 py-2 text-sm"
            style={{ background: "rgba(244,63,94,0.08)" }}
          >
            {error}
          </div>
        ) : null}

        <div className="table-wrap" style={{ marginTop: 12 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 60 }}>ID</th>
                <th>Name</th>
                <th style={{ width: 140, textAlign: "right" }}>Price</th>
                <th style={{ width: 220, textAlign: "right" }}>Stock / Low Threshold</th>
                <th style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id}>
                  <td>{p.id}</td>
                  <td style={{ maxWidth: 420, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {p.name}
                  </td>
                  <td style={{ textAlign: "right" }}>{inr(Number(p.price || 0))}</td>
                  <td style={{ textAlign: "right" }}>
                    <InlineStockLowEdit
                      id={p.id}
                      stock={Number(p.stock_qty || 0)}
                      low={Number(p.low_stock_threshold || 0)}
                      returnTo={returnTo}
                    />
                  </td>
                  <td style={{ textAlign: "right" }} />
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={5} className="muted" style={{ textAlign: "center", padding: 16 }}>
                    No low-stock products found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex items-center justify-between text-sm">
          <div className="muted">
            Page {currentPage} of {totalPages} • {total} results
          </div>
          <div className="flex items-center gap-2">
            <a
              className={`px-3 py-2 rounded-xl border ${currentPage <= 1 ? "pointer-events-none opacity-50" : ""}`}
              href={currentPage <= 1 ? "#" : pageHref(currentPage - 1)}
            >
              Prev
            </a>
            <a
              className={`px-3 py-2 rounded-xl border ${currentPage >= totalPages ? "pointer-events-none opacity-50" : ""}`}
              href={currentPage >= totalPages ? "#" : pageHref(currentPage + 1)}
            >
              Next
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function InlineStockLowEdit({
  id,
  stock,
  low,
  returnTo,
}: {
  id: number;
  stock: number;
  low: number;
  returnTo: string;
}) {
  return (
    <form
      action={`/api/products/${id}`}
      method="post"
      style={{ display: "inline-flex", gap: 6, justifyContent: "flex-end", width: "100%" }}
    >
      <input type="hidden" name="_method" value="PATCH" />
      <input type="hidden" name="return_to" value={returnTo} />
      <input type="number" name="stock_qty" defaultValue={stock} min={0} style={{ width: 110, textAlign: "right" }} />
      <input
        type="number"
        name="low_stock_threshold"
        defaultValue={low}
        min={0}
        style={{ width: 110, textAlign: "right" }}
      />
      <button type="submit" className="btn-outline">
        Save
      </button>
    </form>
  );
}
