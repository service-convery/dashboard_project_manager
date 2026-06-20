// === Helper di formattazione e funzioni pure ===
import { MONTHS, CLOSED_STATUSES } from "./config.js";

export function isClosedStatus(t){
  const s = t && t.status;
  const v = (s && typeof s === "object" && s.status) ? s.status : s;
  return CLOSED_STATUSES.has(String(v || "").toLowerCase().trim());
}

export function pad(n){ return String(n).padStart(2,"0"); }
export function fmtDate(d){ return d.getFullYear() + "-" + pad(d.getMonth()+1) + "-" + pad(d.getDate()); }
export function fmtDay(d){ return pad(d.getDate()) + " " + MONTHS[d.getMonth()]; }
export function fmtDayYear(d){ return pad(d.getDate()) + " " + MONTHS[d.getMonth()] + " " + d.getFullYear(); }

export function getWeekRange(offsetWeeks){
  const now = new Date();
  const dow = now.getDay();              // 0=dom .. 6=sab
  const offsetMon = (dow === 0) ? -6 : (1 - dow);
  const mon = new Date(now);
  mon.setDate(now.getDate() + offsetMon + (offsetWeeks * 7));
  mon.setHours(0,0,0,0);
  // La settimana va da lunedì 00:00 a domenica 23:59:59.999 (lun–dom).
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6); sun.setHours(23,59,59,999);
  return { mon, sun };
}

// Range del mese (offset 0 = mese corrente). start = primo giorno 00:00, end = ultimo giorno 23:59:59.999.
export function getMonthRange(offsetMonths){
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() + offsetMonths, 1, 0, 0, 0, 0);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

export function initials(name){
  if (!name) return "?";
  const parts = String(name).trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0,2).toUpperCase();
  return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
}

// Etichetta dello status ClickUp (oggetto {status,...} o stringa) come testo.
export function statusText(status){
  return (status && typeof status === "object" && status.status) ? status.status : (status || "");
}

// ms -> "Xh Ym" (ore:minuti, non decimale). Minuti omessi se zero; sotto l'ora solo minuti; 0 -> "0h".
export function fmtHM(ms){
  const totalMin = Math.round((Number(ms) || 0) / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h && m) return h + "h " + m + "m";
  if (h) return h + "h";
  if (m) return m + "m";
  return "0h";
}

export function statusClass(s){
  const k = (s || "").toString().toLowerCase().replace(/\s+/g,"-");
  if (k === "pianificato" || k === "in-attesa" || k === "in-lavorazione" || k === "completato") return "status-" + k;
  return "status-default";
}

export function escapeHtml(s){
  return String(s == null ? "" : s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
