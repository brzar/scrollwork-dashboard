"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSession } from "@/lib/session";
import { Logo } from "@/components/Logo";
import {
  canViewAudit,
  canManageUsers,
  isAdmin,
  ROLE_LABEL,
} from "@/lib/permissions";
import type { Session } from "@/lib/permissions";
import { initials } from "@/lib/format";

type Item = {
  href: string;
  label: string;
  icon: React.ReactNode;
  show: (s: Session) => boolean;
};

type Section = { title?: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    items: [
      { href: "/", label: "Overview", icon: <IconHome />, show: () => true },
    ],
  },
  {
    title: "Analytics",
    items: [
      { href: "/monthly", label: "Revenue", icon: <IconCalendar />, show: () => true },
      { href: "/podcasts", label: "Podcasts", icon: <IconMic />, show: () => true },
    ],
  },
  {
    title: "Admin",
    items: [
      { href: "/admin", label: "Overview", icon: <IconShield />, show: (s) => isAdmin(s) },
      { href: "/admin/profit", label: "Profit", icon: <IconDollar />, show: (s) => isAdmin(s) },
      { href: "/admin/users", label: "Users", icon: <IconUsers />, show: (s) => canManageUsers(s) },
      { href: "/admin/audit", label: "Audit log", icon: <IconLog />, show: (s) => canViewAudit(s) },
    ],
  },
];

const ALL_HREFS = SECTIONS.flatMap((s) => s.items.map((i) => i.href));

export function Sidebar() {
  const session = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    if (pendingHref && pathname === pendingHref) setPendingHref(null);
  }, [pathname, pendingHref]);

  const activeHref = useMemo(() => {
    const target = pendingHref ?? pathname;
    let best = "";
    for (const href of ALL_HREFS) {
      const exact = href === target;
      const prefix = href !== "/" && target.startsWith(href + "/");
      if ((exact || prefix) && href.length > best.length) best = href;
    }
    if (!best && target === "/") return "/";
    return best;
  }, [pathname, pendingHref]);

  function onNavigate(href: string) {
    return (e: React.MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      if (href === pathname) return;
      setPendingHref(href);
      startTransition(() => router.push(href));
    };
  }

  return (
    <aside className="hidden md:flex md:flex-col w-[232px] shrink-0 bg-canvas sticky top-0 h-screen self-start">
      <div className="px-5 h-16 flex items-center gap-2.5">
        <Logo size={28} />
        <div className="font-semibold text-ink-900 tracking-tightish text-[14.5px]">
          Scrollwork
        </div>
      </div>

      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        {SECTIONS.map((section, idx) => {
          const visible = section.items.filter((i) => i.show(session));
          if (visible.length === 0) return null;
          return (
            <div key={idx} className={idx > 0 ? "mt-6" : ""}>
              {section.title ? (
                <div className="px-3 mb-2 text-[11px] font-medium text-ink-400 tracking-wide uppercase">
                  {section.title}
                </div>
              ) : null}
              {visible.map((item) => {
                const active = activeHref === item.href;
                const pending = pendingHref === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch
                    onClick={onNavigate(item.href)}
                    aria-current={active ? "page" : undefined}
                    className={`group flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13.5px] font-medium mb-0.5 select-none transition-all duration-150 ${
                      active
                        ? "bg-panel text-ink-900 shadow-card"
                        : "text-ink-600 hover:text-ink-900 hover:bg-panel/60"
                    }`}
                  >
                    <span
                      className={`shrink-0 transition-colors ${
                        active
                          ? "text-ink-900"
                          : "text-ink-400 group-hover:text-ink-700"
                      }`}
                    >
                      {item.icon}
                    </span>
                    <span className="flex-1">{item.label}</span>
                    {pending ? <Spinner /> : null}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>

      <UserBlock session={session} />
    </aside>
  );
}

function UserBlock({ session }: { session: Session }) {
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      window.location.href = "/login";
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <div className="px-3 py-3">
      <div className="flex items-center gap-2.5 px-2 py-2 rounded-lg hover:bg-panel/60 transition-colors">
        {session.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={session.avatarUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="w-7 h-7 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="w-7 h-7 rounded-full bg-ink-200 text-ink-700 flex items-center justify-center text-[11px] font-semibold shrink-0">
            {initials(session.fullName || session.email)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-ink-900 truncate leading-tight">
            {session.fullName || session.email.split("@")[0]}
          </div>
          <div className="text-[11.5px] text-ink-500 truncate leading-tight mt-0.5">
            {ROLE_LABEL[session.role]}
          </div>
        </div>
        <button
          type="button"
          onClick={onSignOut}
          disabled={signingOut}
          aria-label="Sign out"
          title="Sign out"
          className="shrink-0 p-1.5 rounded-md text-ink-400 hover:text-ink-900 hover:bg-ink-100 transition-colors disabled:opacity-50"
        >
          <SignOutIcon />
        </button>
      </div>
    </div>
  );
}

function svgProps() {
  return {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.75,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

function Spinner() {
  return (
    <svg
      className="animate-spin text-ink-500"
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 1-9 9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}

function IconHome() {
  return (
    <svg {...svgProps()}>
      <path d="M3 11l9-8 9 8v9a2 2 0 0 1-2 2h-4v-7H9v7H5a2 2 0 0 1-2-2v-9z" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg {...svgProps()}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9h18M8 3v4M16 3v4" />
    </svg>
  );
}
function IconMic() {
  return (
    <svg {...svgProps()}>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
function IconShield() {
  return (
    <svg {...svgProps()}>
      <path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" />
    </svg>
  );
}
function IconDollar() {
  return (
    <svg {...svgProps()}>
      <path d="M12 3v18" />
      <path d="M17 7H9.5a2.5 2.5 0 0 0 0 5h5a2.5 2.5 0 0 1 0 5H7" />
    </svg>
  );
}
function IconUsers() {
  return (
    <svg {...svgProps()}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20c0-3 3-5 6-5s6 2 6 5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M15 20c0-2.5 2-4 4-4" />
    </svg>
  );
}
function IconLog() {
  return (
    <svg {...svgProps()}>
      <path d="M4 4h16v16H4z" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </svg>
  );
}
