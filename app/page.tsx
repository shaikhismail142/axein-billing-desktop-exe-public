// app/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const runtime = "nodejs";

import { redirect } from "next/navigation";
import { isActivated } from "@/app/lib/activation-check";
import { pool } from "@/lib/db";

async function hasRegisteredBusiness() {
  try {
    const rs = await pool.query(
      `SELECT b.id
         FROM businesses b
         LEFT JOIN users u
           ON u.business_id = b.id
          AND lower(u.status) = 'active'
        WHERE b.is_active = TRUE
        GROUP BY b.id
       HAVING COUNT(u.id) > 0
        ORDER BY b.id ASC
        LIMIT 1`
    );
    return rs.rowCount > 0;
  } catch {
    // Keep backward compatibility before migration is applied.
    return true;
  }
}

export default async function Page() {
  if (process.env.APP_ACTIVATION_REQUIRED === "true") {
    const ok = await isActivated();
    if (!ok) redirect("/activate");
  }

  if (process.env.APP_REQUIRE_BUSINESS_SETUP === "true") {
    const ready = await hasRegisteredBusiness();
    if (!ready) redirect("/activate");
  }

  // If activated (or activation not required), send root to the dashboard
  redirect("/dashboard");
}
