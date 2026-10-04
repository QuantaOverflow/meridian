/**
 * 「N word」/「N words」：count === 1 用单数，否则用 plural（默认 `${singular}s`）。
 * 统计类文案（N stories / N issues / N days…）统一走这里，不在每个组件各写一遍三元。
 */
export function pluralize(count: number, singular: string, plural: string = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** 格式化为 `YYYY-MM-DD HH:mm:ss`；输入缺失或非法日期时返回 '-'。 */
export function formatDate(dateStr: string | undefined) {
  if (dateStr === undefined) {
    return '-';
  }
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    return '-';
  }
  const Y = date.getFullYear();
  const M = String(date.getMonth() + 1).padStart(2, '0');
  const D = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}:${s}`;
}
