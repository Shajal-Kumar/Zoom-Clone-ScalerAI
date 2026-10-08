"use client";

import { useCallback, useEffect, useState } from "react";

/** Tiny toast: `show(msg)` and render `node` once at the end of the page. */
export function useToast() {
  const [message, setMessage] = useState<string | null>(null);
  const show = useCallback((m: string) => setMessage(m), []);

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => setMessage(null), 3000);
    return () => clearTimeout(id);
  }, [message]);

  const node = message ? (
    <div role="status" className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded-lg bg-[#13151B] px-4 py-2 text-sm text-white shadow-lg">
      {message}
    </div>
  ) : null;

  return { show, node };
}
