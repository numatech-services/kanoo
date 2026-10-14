"use client";
import { useState, useEffect } from "react";
import Link from "next/link";

import { Bell } from "lucide-react";
import { apiJson } from "@/lib/api-client";
export function NotificationsBell() {
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    async function load() {
      try {
        const d = await apiJson("/api/notifications?unread=true&limit=1");
        setUnread(d.data?.pagination?.total || 0);
      } catch {}
    }
    load();
    const interval = setInterval(load, 60_000); // Polling 1 min
    return () => clearInterval(interval);
  }, []);

  return (
    <Link href="/notifications" className="relative text-ink2 hover:text-ink transition-colors">
      <span className="inline-flex" aria-hidden><Bell size={20} /></span>
      {unread > 0 && (
        <span className="absolute -top-1 -right-1 w-4 h-4 bg-neg text-white text-xs rounded-full flex items-center justify-center font-bold leading-none">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </Link>
  );
}
