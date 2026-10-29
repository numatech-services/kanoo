import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db";
import { withAuth, badRequest } from "@/lib/api-helpers";
import { TokenPayload } from "@/lib/auth";
import { CalendarEventModel } from "@/models/CalendarEvent";
import { visibleFilter } from "@/lib/agenda";
import { virtualAgenda } from "@/lib/agenda-virtual";
import { localDay } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Texte iCalendar (RFC 5545) : barres obliques, virgules, points-virgules et retours échappés. */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/[,;]/g, m => `\\${m}`).replace(/\r?\n/g, "\\n");
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const day = (d: Date) => localDay(d).replace(/-/g, "");

/**
 * GET /api/agenda/ics?from=&to= — l'agenda visible de l'utilisateur (ses
 * événements, les partagés, les échéances des marchés et les jours fériés)
 * au format .ics, à importer dans Outlook ou Google Agenda.
 */
export const GET = withAuth("agenda", "read", async (req: NextRequest, auth: TokenPayload) => {
  await connectDB();
  const url = new URL(req.url);
  const from = new Date(url.searchParams.get("from") || ""), to = new Date(url.searchParams.get("to") || "");
  if (isNaN(from.getTime()) || isNaN(to.getTime()) || to <= from) return badRequest("Période invalide.");
  if (to.getTime() - from.getTime() > 400 * 86_400_000) return badRequest("Période trop longue (un an au plus).");
  const events = await CalendarEventModel.find({ ...visibleFilter(auth), startAt: { $gte: from, $lt: to }, status: { $ne: "cancelled" } })
    .sort({ startAt: 1 }).limit(2000).lean<Array<{ _id: unknown; title: string; description?: string; location?: string; meetingLink?: string; startAt: Date; endAt?: Date; allDay?: boolean; updatedAt?: Date }>>();
  const virtual = await virtualAgenda(auth, from, to);
  const stamp = utc(new Date());
  const host = url.host.replace(/[^a-z0-9.-]/gi, "") || "kanoo";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kanoo//Agenda//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH"];
  const push = (uid: string, title: string, start: Date, end: Date | undefined, allDay: boolean, desc?: string, loc?: string) => {
    lines.push("BEGIN:VEVENT", `UID:${uid}@${host}`, `DTSTAMP:${stamp}`);
    if (allDay) {
      // Date de fin exclue (RFC 5545) : le lendemain du dernier jour.
      const last = end && end > start ? end : start;
      const next = new Date(last); next.setDate(next.getDate() + 1);
      lines.push(`DTSTART;VALUE=DATE:${day(start)}`, `DTEND;VALUE=DATE:${day(next)}`);
    } else {
      lines.push(`DTSTART:${utc(start)}`, `DTEND:${utc(end && end > start ? end : new Date(start.getTime() + 3_600_000))}`);
    }
    lines.push(`SUMMARY:${esc(title)}`);
    if (desc) lines.push(`DESCRIPTION:${esc(desc)}`);
    if (loc) lines.push(`LOCATION:${esc(loc)}`);
    lines.push("END:VEVENT");
  };
  for (const e of events) push(String(e._id), e.title, new Date(e.startAt), e.endAt ? new Date(e.endAt) : undefined, Boolean(e.allDay), [e.description, e.meetingLink].filter(Boolean).join("\n"), e.location);
  for (const v of virtual) push(v._id, v.title, new Date(v.startAt), undefined, true, v.description);
  lines.push("END:VCALENDAR");
  // Lignes repliées à 75 octets (RFC 5545 §3.1) : continuation par un espace.
  const fold = (l: string) => {
    const out: string[] = []; let cur = "", bytes = 0;
    for (const ch of l) {
      const b = Buffer.byteLength(ch);
      if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
      cur += ch; bytes += b;
    }
    out.push(cur);
    return out.join("\r\n ");
  };
  return new NextResponse(lines.map(fold).join("\r\n") + "\r\n", {
    headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="agenda-${localDay(from)}.ics"`, "Cache-Control": "no-store" },
  });
});
