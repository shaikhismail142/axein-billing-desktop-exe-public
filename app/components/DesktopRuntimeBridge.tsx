"use client";

import { useEffect } from "react";

function detectDesktop() {
  if (typeof window === "undefined") return false;
  const w = window as any;
  if (Boolean(w.__TAURI_INTERNALS__)) return true;
  const ua = navigator.userAgent || "";
  return /tauri/i.test(ua) || /axein desktop/i.test(ua);
}

export default function DesktopRuntimeBridge() {
  useEffect(() => {
    if (!detectDesktop()) return;

    const html = document.documentElement;
    const body = document.body;
    html.classList.add("axein-desktop");
    body.classList.add("axein-desktop");

    const platform = navigator.userAgent.toLowerCase().includes("windows")
      ? "windows"
      : navigator.userAgent.toLowerCase().includes("mac")
      ? "mac"
      : "other";

    html.setAttribute("data-platform", platform);

    // Prevent accidental file drop navigation in desktop shell.
    const onDragOver = (e: DragEvent) => e.preventDefault();
    const onDrop = (e: DragEvent) => e.preventDefault();

    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);

    return () => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  return null;
}
