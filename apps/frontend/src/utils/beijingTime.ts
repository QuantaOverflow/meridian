/**
 * 运维台的时间一律显示北京时间（UTC+8），不跟浏览器时区走：管理员在哪看都是同一个钟点。
 * 输入是接口给的 UTC ISO 字符串；缺失或非法时返回 '-'。
 */
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function beijingParts(iso: string | null | undefined) {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  const d = new Date(t + BEIJING_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    date: `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`,
    hm: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    s: pad(d.getUTCSeconds()),
  };
}

/** `Oct 5` */
export function beijingDate(iso: string | null | undefined): string {
  return beijingParts(iso)?.date ?? '-';
}

/** `21:02`；`withSeconds` 时 `21:02:01` */
export function beijingTime(iso: string | null | undefined, withSeconds = false): string {
  const p = beijingParts(iso);
  return p ? (withSeconds ? `${p.hm}:${p.s}` : p.hm) : '-';
}

/** `Oct 5 21:02` */
export function beijingDateTime(iso: string | null | undefined): string {
  const p = beijingParts(iso);
  return p ? `${p.date} ${p.hm}` : '-';
}

/**
 * 计费周期的起止，北京时间。接口给的是 UTC 日（`2026-10-04` 到 `2026-11-03`，含两端）；Cloudflare 按 UTC 零点切周期，
 * 也就是北京 8 点：`Oct 4 08:00 – Nov 4 08:00`。
 */
export function beijingCycleRange(startDay: string, endDay: string): string {
  const start = `${startDay}T00:00:00Z`;
  const end = new Date(Date.parse(`${endDay}T00:00:00Z`) + 24 * 60 * 60 * 1000).toISOString();
  return `${beijingDateTime(start)} – ${beijingDateTime(end)}`;
}
