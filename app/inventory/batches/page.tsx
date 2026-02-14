// app/inventory/batches/page.tsx
import BatchesClient from "./_components/BatchesClient";
import { getServerRequestContext } from "@/app/lib/server-request";

export const dynamic = "force-dynamic";
export const revalidate = 0;                 // number (valid)
export const fetchCache = "force-no-store";

export type Batch = {
  id: string;
  product_id: string;
  product_name: string | null;
  sku: string | null;
  batch_no: string;
  mfg_date: string | null;
  exp_date: string | null;
  qty: string;
  cost_price: string | null;
  mrp: string | null;
  supplier_id: string | null;
  days_left: number | null;
};

export type ApiResp = {
  ok: boolean;
  page: number;
  pageSize: number;
  total: number;
  items: Batch[];
  prefs: { near_expiry_days: number };
};

type PageProps = {
  searchParams?: {
    page?: string;
    q?: string;
    expiry?: "all" | "near" | "expired";
    onlyQty?: "true" | "false";
  };
};

async function getBatches(
  searchParams: PageProps["searchParams"],
  ctx: ReturnType<typeof getServerRequestContext>
): Promise<ApiResp> {
  const page    = searchParams?.page    ?? "1";
  const q       = searchParams?.q       ?? "";
  const expiry  = searchParams?.expiry  ?? "all";
  const onlyQty = searchParams?.onlyQty ?? "true";

  const qs = new URLSearchParams({
    page,
    pageSize: "20",
    q,
    expiry,
    onlyQty,
  });

  const url = `${ctx.baseUrl}/api/batches?${qs.toString()}`;

  // Choose ONE strategy; here we use no-store only.
  const res = await fetch(url, { cache: "no-store", headers: ctx.authHeaders });

  if (!res.ok) {
    console.error("[/inventory/batches] /api/batches failed", res.status, await res.text());
    return {
      ok: false,
      page: Number(page) || 1,
      pageSize: 20,
      total: 0,
      items: [],
      prefs: { near_expiry_days: 30 },
    };
  }

  return res.json();
}

export default async function BatchesPage({ searchParams }: PageProps) {
  const ctx = getServerRequestContext();
  const initialData = await getBatches(searchParams, ctx);

  const current = {
    page: searchParams?.page ?? "1",
    q: searchParams?.q ?? "",
    expiry: (searchParams?.expiry as "all" | "near" | "expired") ?? "all",
    onlyQty: (searchParams?.onlyQty as "true" | "false") ?? "true",
  };

  return <BatchesClient initialData={initialData} current={current} />;
}
