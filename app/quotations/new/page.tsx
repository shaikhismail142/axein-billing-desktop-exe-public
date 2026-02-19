import NewQuotationForm from './NewQuotationForm';
import { getServerRequestContext } from "@/app/lib/server-request";

export const dynamic = 'force-dynamic';

async function fetchAllProducts(baseUrl: string, authHeaders: HeadersInit) {
  const perPage = 500;
  const maxPages = 50;
  let page = 1;
  let totalPages = 1;
  const out: any[] = [];
  while (page <= Math.min(maxPages, totalPages)) {
    const res = await fetch(`${baseUrl}/api/products?page=${page}&perPage=${perPage}`, {
      cache: "no-store",
      headers: authHeaders,
    });
    if (!res.ok) break;
    const data = await res.json().catch(() => ({}));
    const items = Array.isArray(data?.items) ? data.items : [];
    out.push(...items);
    totalPages = Number(data?.totalPages || totalPages || 1);
    if (items.length === 0) break;
    page += 1;
  }
  const seen = new Set<number>();
  const uniq: any[] = [];
  for (const row of out) {
    const id = Number(row?.id);
    if (!Number.isFinite(id) || seen.has(id)) continue;
    seen.add(id);
    uniq.push(row);
  }
  return uniq;
}

export default async function Page() {
  const ctx = getServerRequestContext();
  const [products, fieldsRes] = await Promise.all([
    fetchAllProducts(ctx.baseUrl, ctx.authHeaders),
    fetch(`${ctx.baseUrl}/api/settings/invoice-custom-fields?applies_to=quotation&visible=1`, {
      cache: "no-store",
      headers: ctx.authHeaders,
    }),
  ]);
  const fieldsData = fieldsRes.ok ? await fieldsRes.json().catch(() => ({ items: [] })) : { items: [] };
  const customFields = Array.isArray(fieldsData?.items) ? fieldsData.items : [];
  return <NewQuotationForm products={products} customFields={customFields} />;
}
