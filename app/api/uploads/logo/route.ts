// app/api/uploads/logo/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import path from "node:path";
import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { requireAnyPermission } from "@/app/lib/request-access";
import { isSaasDeployment } from "@/app/lib/deployment";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp"]);
const EXT_FROM_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const MAX_BYTES = 2 * 1024 * 1024; // 2 MB

function extFromName(name: string): string | null {
  const m = name.toLowerCase().match(/\.([a-z0-9]{2,8})$/i);
  if (!m) return null;
  const e = m[1];
  if (["png", "jpg", "jpeg", "webp"].includes(e)) {
    return e === "jpeg" ? "jpg" : e;
  }
  return null;
}

function makeFilename(ext: string) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const short = crypto.randomUUID().slice(0, 8);
  return `logo_${stamp}_${short}.${ext}`;
}

function objectStore() {
  const endpoint = String(process.env.S3_ENDPOINT || "").trim();
  const bucket = String(process.env.S3_BUCKET || "").trim();
  const accessKeyId = String(process.env.S3_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.S3_SECRET_ACCESS_KEY || "").trim();
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    throw new Error("Private object storage is not configured");
  }
  return {
    bucket,
    client: new S3Client({
      endpoint,
      region: String(process.env.S3_REGION || "auto"),
      forcePathStyle: process.env.S3_PATH_STYLE === "1",
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

export async function POST(req: Request) {
  try {
    const access = await requireAnyPermission(req, ["perm.settings.manage"], "Forbidden");
    if ("response" in access) return access.response;
    const businessId = access.ctx.businessId;

    const ctype = req.headers.get("content-type") || "";
    if (!ctype.toLowerCase().includes("multipart/form-data")) {
      return NextResponse.json(
        { error: "Content-Type must be multipart/form-data" },
        { status: 415 }
      );
    }

    const form = await req.formData().catch(() => null);
    if (!form) {
      return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
    }

    // Validate type
    const mime = (file.type || "").toLowerCase();
    if (!ALLOWED.has(mime)) {
      return NextResponse.json(
        { error: "Only PNG, JPG, or WebP images are allowed" },
        { status: 400 }
      );
    }

    // Read into memory to check size / write to disk
    const ab = await file.arrayBuffer();
    const size = ab.byteLength;
    if (size <= 0) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    if (size > MAX_BYTES) {
      return NextResponse.json(
        { error: `File too large. Max ${Math.round(MAX_BYTES / (1024 * 1024))} MB` },
        { status: 413 }
      );
    }

    // Resolve extension
    const byMime = EXT_FROM_MIME[mime];
    const byName = extFromName(file.name || "");
    const ext = (byMime || byName || "png").toLowerCase();

    const filename = makeFilename(ext);
    const u8 = new Uint8Array(ab);
    if (isSaasDeployment()) {
      const key = `tenants/${businessId}/logos/${filename}`;
      const store = objectStore();
      await store.client.send(new PutObjectCommand({ Bucket: store.bucket, Key: key, Body: u8, ContentType: mime }));
      return NextResponse.json({ url: `/api/uploads/logo?key=${encodeURIComponent(key)}` }, { status: 200 });
    }

    // Desktop builds keep assets in their local runtime.
    const dir = path.join(process.cwd(), "public", "uploads", "logos", String(businessId));
    await mkdir(dir, { recursive: true });

    const filepath = path.join(dir, filename);
    await writeFile(filepath, u8);

    // Public URL (served by Next static from /public)
    const url = `/uploads/logos/${businessId}/${filename}`;

    return NextResponse.json({ url }, { status: 200 });
  } catch (err: any) {
    console.error("Logo upload failed:", err?.message || err);
    return NextResponse.json(
      { error: "Upload failed", detail: String(err?.message || err) },
      { status: 500 }
    );
  }
}

export async function GET(req: Request) {
  if (!isSaasDeployment()) return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
  const access = await requireAnyPermission(req, ["perm.settings.manage", "perm.sales.view", "perm.quotations.view"], "Forbidden");
  if ("response" in access) return access.response;
  const key = String(new URL(req.url).searchParams.get("key") || "");
  const prefix = `tenants/${access.ctx.businessId}/logos/`;
  if (!key.startsWith(prefix) || key.includes("..")) return NextResponse.json({ error: "invalid_asset_key" }, { status: 400 });
  try {
    const store = objectStore();
    const object = await store.client.send(new GetObjectCommand({ Bucket: store.bucket, Key: key }));
    if (!object.Body) return NextResponse.json({ error: "asset_not_found" }, { status: 404 });
    const bytes = await object.Body.transformToByteArray();
    const body = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    return new NextResponse(body, {
      headers: { "Content-Type": object.ContentType || "application/octet-stream", "Cache-Control": "private, max-age=300" },
    });
  } catch (error: any) {
    console.error("Logo read failed:", error?.message || error);
    return NextResponse.json({ error: "asset_unavailable" }, { status: 404 });
  }
}
