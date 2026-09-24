/** Markdown is authoritative; validate first, then generate INDEX.md. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const KINDS: Record<string, string> = { approach: '做法', fact: '读数/规律', decision: '决定' };
export const VERDICTS: Record<string, string> = { failed: '走不通', works: '可行', open: '未验证' };
const STATUSES = ['current', 'superseded'];

export type Entry = {
  id: string;
  kind: string;
  verdict?: string;
  title: string;
  date: string;
  status: string;
  superseded_by?: string;
  tasks: string[];
  scope?: string;
  invalidates_when?: string;
  source: string;
  file: string;
  content: string;
};
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

export function parseEntry(file: string, raw: string): Entry {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/);
  if (!match) throw new Error(`${file}: 缺少 JSON frontmatter`);
  let metadata: unknown;
  try {
    metadata = JSON.parse(match[1]);
  } catch {
    throw new Error(`${file}: frontmatter 必须为 JSON 对象，见 docs/knowledge/README.md`);
  }
  if (!object(metadata)) throw new Error(`${file}: frontmatter 必须为对象`);
  if ('file' in metadata || 'content' in metadata) throw new Error(`${file}: file/content 为生成字段`);
  return { ...metadata, file, content: match[2].trim() } as Entry;
}

export function validate(entries: Entry[]): void {
  const errors: string[] = [];
  if (!entries.length) errors.push('没有记录');
  const ids = new Set<string>();
  for (const e of entries) {
    const fail = (message: string) => errors.push(`${e.file}: ${message}`);
    for (const k of ['id', 'title', 'date', 'source'] as const) if (!nonempty(e[k])) fail(`缺少非空字符串 ${k}`);
    if (!nonempty(e.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(e.id)) fail('id 必须为小写 slug');
    if (ids.has(e.id)) fail(`重复 id ${e.id}`);
    ids.add(e.id);
    if (e.id !== basename(e.file, '.md')) fail('文件名必须与 id 相同');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date ?? '')) fail('date 必须为 YYYY-MM-DD');
    if (!(e.kind in KINDS)) fail(`kind 必须为 ${Object.keys(KINDS).join(' / ')}`);
    if (e.kind === 'approach' ? !(String(e.verdict) in VERDICTS) : 'verdict' in e)
      fail(`verdict 只给 approach，且必须为 ${Object.keys(VERDICTS).join(' / ')}`);
    if (!STATUSES.includes(e.status)) fail(`status 必须为 ${STATUSES.join(' / ')}`);
    if ((e.status === 'superseded') !== nonempty(e.superseded_by)) fail('status=superseded 与 superseded_by 必须同时出现');
    if (!Array.isArray(e.tasks) || !e.tasks.length || !e.tasks.every(nonempty)) fail('tasks 必须为非空字符串数组');
    for (const k of ['scope', 'invalidates_when'] as const) if (k in e && !nonempty(e[k])) fail(`${k} 给了就不能为空`);
    if (!nonempty(e.content)) fail('正文不能为空');
  }
  for (const e of entries) {
    if (e.superseded_by && !ids.has(e.superseded_by)) errors.push(`${e.file}: superseded_by 指向不存在的 ${e.superseded_by}`);
    for (const [, to] of e.content.matchAll(/\[\[([a-z0-9-]+)\]\]/g))
      if (!ids.has(to)) errors.push(`${e.file}: [[${to}]] 指向不存在的记录`);
  }
  if (errors.length) throw new Error(`知识库校验失败，未生成文件：\n${errors.join('\n')}`);
}

export function build(
  root = resolve(HERE, '../../docs/knowledge'),
  checkOnly = false,
  checkGenerated = false
): { entries: number } {
  const dir = resolve(root, 'nodes');
  const entries = readdirSync(dir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => parseEntry(f, readFileSync(resolve(dir, f), 'utf8')));
  validate(entries);
  if (!checkOnly || checkGenerated) {
    const label = (e: Entry) => (e.kind === 'approach' ? `做法·${VERDICTS[e.verdict!]}` : KINDS[e.kind]);
    const rank = (e: Entry) => [...Object.keys(VERDICTS).map(v => `approach:${v}`), 'fact', 'decision'].indexOf(e.kind === 'approach' ? `approach:${e.verdict}` : e.kind);
    const line = (e: Entry) => `- [${label(e)}] [${e.title}](nodes/${e.file}) · ${e.date}`;
    const current = entries.filter(e => e.status === 'current');
    const out = [
      '# 探索记录索引',
      '',
      '> 自动生成：修改 nodes/ 后运行 `pnpm -s knowledge`。格式见 [README](README.md)。',
      '',
      `记录 ${entries.length} 条（现行 ${current.length}）。`,
      '',
    ];
    for (const task of [...new Set(current.flatMap(e => e.tasks))].sort()) {
      out.push(`## ${task}`, '');
      for (const e of current.filter(e => e.tasks.includes(task)).sort((a, b) => rank(a) - rank(b) || a.date.localeCompare(b.date)))
        out.push(line(e));
      out.push('');
    }
    const old = entries.filter(e => e.status === 'superseded');
    if (old.length) {
      out.push('## 已被取代', '');
      for (const e of old) out.push(`${line(e)} → \`${e.superseded_by}\``);
      out.push('');
    }
    const index = out.join('\n');
    const file = resolve(root, 'INDEX.md');
    if (checkGenerated) {
      if (!existsSync(file) || readFileSync(file, 'utf8') !== index)
        throw new Error('INDEX.md 缺失或过期。运行 pnpm -s knowledge 更新。');
    } else writeFileSync(file, index);
  }
  return { entries: entries.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(a => !['--check', '--check-generated'].includes(a))) throw new Error('仅支持 --check / --check-generated（只校验，不写文件）');
    const checkOnly = args.includes('--check') || args.includes('--check-generated');
    const counts = build(undefined, checkOnly, args.includes('--check-generated'));
    console.log(`[knowledge] ${counts.entries} 条记录${checkOnly ? ' 校验通过' : ' → INDEX.md'}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
