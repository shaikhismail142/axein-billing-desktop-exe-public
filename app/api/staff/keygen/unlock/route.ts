export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import {
  createKeygenUnlockToken,
  isKeygenUnlocked,
  makeClearedKeygenUnlockCookie,
  makeKeygenUnlockCookie,
} from "@/app/lib/keygen-session";

const DEFAULT_SUPER_PASSWORD = "AxEin!K3yG3n#2026@Sup3r-Only";

function keygenApiAvailable() {
  return process.env.AXEIN_APP_MODE === "keygen" || process.env.AXEIN_INCLUDE_KEYGEN_UI === "1";
}

async function hasPrivateKey() {
  const explicit = process.env.AXEIN_KEYGEN_PRIVATE_KEY_PATH?.trim();
  const candidates = [
    explicit ? path.resolve(explicit) : "",
    path.join(process.cwd(), "vendor", "keygen", "ed25519-private.pem"),
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      const pem = await fs.readFile(p, "utf8");
      if (pem.includes("BEGIN PRIVATE KEY")) return true;
    } catch {
      // continue
    }
  }
  return false;
}

function forbidden(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 403 });
}

function secureEquals(a: string, b: string) {
  const aSig = crypto.createHash("sha256").update(String(a || ""), "utf8").digest("hex");
  const bSig = crypto.createHash("sha256").update(String(b || ""), "utf8").digest("hex");
  if (aSig.length !== bSig.length) return false;
  let diff = 0;
  for (let i = 0; i < aSig.length; i += 1) {
    diff |= aSig.charCodeAt(i) ^ bSig.charCodeAt(i);
  }
  return diff === 0;
}

export async function GET(req: Request) {
  if (!keygenApiAvailable()) {
    return NextResponse.json({
      ok: true,
      available: false,
      unlocked: false,
      message: "Not available on this install",
    });
  }

  const available = await hasPrivateKey();
  return NextResponse.json({
    ok: true,
    available,
    unlocked: isKeygenUnlocked(req),
    ...(available ? {} : { message: "Keygen private key missing in this install. Reinstall keygen package." }),
  });
}

export async function POST(req: Request) {
  if (!keygenApiAvailable()) {
    return NextResponse.json({ ok: false, error: "Not available on this install" }, { status: 404 });
  }
  if (!(await hasPrivateKey())) {
    return NextResponse.json({ ok: false, error: "Not available on this install" }, { status: 404 });
  }
  if (req.headers.get("x-admin") !== "1") {
    return forbidden("Admin context required");
  }

  const body = (await req.json().catch(() => ({}))) as { super_password?: string };
  const entered = String(body.super_password || "");
  const expected = String(process.env.AXEIN_SUPER_KEYGEN_PASSWORD || DEFAULT_SUPER_PASSWORD);
  if (!entered || !secureEquals(entered, expected)) {
    return forbidden("Super password validation failed");
  }

  const token = createKeygenUnlockToken();
  const response = NextResponse.json({ ok: true, unlocked: true });
  response.headers.append("Set-Cookie", makeKeygenUnlockCookie(token));
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true, unlocked: false });
  response.headers.append("Set-Cookie", makeClearedKeygenUnlockCookie());
  return response;
}
