"use client";

import { useEffect } from "react";

/** Registers /sw.js in production builds only (dev HMR and SW caching don't mix). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Non-fatal: the app works without offline support.
    });
  }, []);
  return null;
}
