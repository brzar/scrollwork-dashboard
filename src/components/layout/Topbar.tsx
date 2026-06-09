"use client";

import { usePathname } from "next/navigation";

const TITLES: Array<{ match: RegExp; label: string }> = [
  { match: /^\/$/, label: "Overview" },
  { match: /^\/monthly/, label: "Revenue" },
  { match: /^\/podcasts\/[^/]+$/, label: "Podcast" },
  { match: /^\/podcasts/, label: "Podcasts" },
  { match: /^\/admin\/users/, label: "Users" },
  { match: /^\/admin\/audit/, label: "Audit log" },
  { match: /^\/admin\/profit/, label: "Profit" },
  { match: /^\/admin/, label: "Admin" },
];

function titleFromPath(pathname: string): string {
  for (const t of TITLES) if (t.match.test(pathname)) return t.label;
  return "";
}

/**
 * Slim, border-free topbar. The page header carries the real H1; this
 * is just a faint locator while content scrolls. Mirrors the
 * Spotify-for-Creators app shell — sidebar holds identity, topbar
 * stays out of the way.
 */
export function Topbar() {
  const pathname = usePathname();
  return (
    <header className="h-16 shrink-0 bg-canvas/95 backdrop-blur-sm flex items-center px-10 sticky top-0 z-10">
      <div className="text-[13px] font-medium text-ink-500 tracking-tight">
        {titleFromPath(pathname)}
      </div>
    </header>
  );
}
