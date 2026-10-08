"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Contact, Home, MessagesSquare, Settings, Video, type LucideIcon } from "lucide-react";

interface ItemProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  href?: string;
  onClick?: () => void;
  unavailable?: boolean;
}

function Item({ icon: Icon, label, active, href, onClick, unavailable }: ItemProps) {
  const cls = `flex w-14 flex-col items-center gap-1 rounded-lg py-2 text-[11px] font-medium transition-colors ${
    active ? "bg-[var(--card)] text-[var(--text)] shadow-sm" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
  }`;
  const inner = (
    <>
      <Icon size={20} aria-hidden />
      <span>{label}</span>
    </>
  );
  if (href)
    return (
      <Link href={href} aria-current={active ? "page" : undefined} className={cls}>
        {inner}
      </Link>
    );
  return (
    <button
      type="button"
      onClick={onClick}
      aria-disabled={unavailable || undefined}
      title={unavailable ? `${label} is not available yet` : undefined}
      className={`${cls} ${unavailable ? "cursor-default" : ""}`}
    >
      {inner}
    </button>
  );
}

export function Sidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const pathname = usePathname() ?? "/";

  return (
    <aside aria-label="Sidebar" className="flex w-16 shrink-0 flex-col items-center justify-between py-2">
      <nav className="flex flex-col items-center gap-1" aria-label="Primary">
        <Item icon={Home} label="Home" href="/" active={pathname === "/"} />
        <Item icon={MessagesSquare} label="Chat" unavailable />
        <Item icon={Video} label="Meetings" href="/meetings" active={pathname.startsWith("/meetings")} />
        <Item icon={Contact} label="Contacts" unavailable />
      </nav>
      <Item icon={Settings} label="Settings" onClick={onOpenSettings} />
    </aside>
  );
}
