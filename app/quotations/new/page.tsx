import NewQuotationForm from './NewQuotationForm';
import { getServerRequestContext } from "@/app/lib/server-request";

export const dynamic = 'force-dynamic';

export default async function Page() {
  const ctx = getServerRequestContext();
  const res = await fetch(`${ctx.baseUrl}/api/products?limit=1000`, { cache: 'no-store', headers: ctx.authHeaders });
  const data = res.ok ? await res.json().catch(() => ({ items: [] })) : { items: [] };
  const products = Array.isArray(data?.items) ? data.items : [];
  return <NewQuotationForm products={products} />;
}
