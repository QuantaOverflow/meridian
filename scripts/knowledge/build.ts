/** Markdown is authoritative; validate first, then generate INDEX.md and graph.json. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA = JSON.parse(readFileSync(resolve(HERE, 'schema.json'), 'utf8')) as {
  version: number;
  entities: Record<string, { label: string; required: string[] }>;
  relations: Record<
    string,
    { from: string[]; to: string[]; label: string; required_attributes?: string[]; same_type?: boolean }
  >;
};
export type Relation = { type: string; to: string; attributes?: Record<string, string> };
export type Entity = {
  id: string;
  type: string;
  title: string;
  date: string;
  status: string;
  tasks: string[];
  scope: string;
  source: string;
  conditions: string[];
  evidence_origin: string;
  relations: Relation[];
  file: string;
  content: string;
  [key: string]: unknown;
};
const nonempty = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const stringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every(nonempty);

export function parseEntity(file: string, raw: string): Entity {
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
  return { ...metadata, file, content: match[2].trim() } as Entity;
}

export function validateGraph(nodes: Entity[]): void {
  const errors: string[] = [];
  if (!nodes.length) errors.push('没有节点');
  const byId = new Map<string, Entity>();
  for (const n of nodes) {
    const fail = (message: string) => errors.push(`${n.file}: ${message}`);
    for (const k of ['id', 'type', 'title', 'date', 'status', 'scope', 'source', 'evidence_origin']) {
      if (!nonempty(n[k])) fail(`缺少非空字符串 ${k}`);
    }
    if (!nonempty(n.id) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(n.id)) fail('id 必须为小写 slug');
    if (byId.has(n.id)) fail(`重复 id ${n.id}`);
    byId.set(n.id, n);
    if (n.id !== basename(n.file, '.md')) fail('文件名必须与 id 相同');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(n.date ?? '')) fail('date 必须为 YYYY-MM-DD');
    if (!stringArray(n.tasks) || !n.tasks.length) fail('tasks 必须为非空字符串数组');
    if (!stringArray(n.conditions)) fail('conditions 必须为字符串数组');
    const rule = SCHEMA.entities[n.type];
    if (!rule) fail(`未知实体类型 ${n.type}`);
    else for (const k of rule.required) if (!nonempty(n[k])) fail(`缺少 ${n.type} 字段 ${k}`);
    if (
      n.type === 'experiment' &&
      !['passed', 'failed', 'mixed', 'observed', 'not_evaluated'].includes(String(n.outcome))
    )
      fail('未知实验 outcome');
    if (n.type === 'experiment' && !['complete', 'summary_only'].includes(String(n.record_completeness)))
      fail('未知 record_completeness');
    if (
      n.type === 'attempt' &&
      n.verification === 'proposed' &&
      Array.isArray(n.relations) &&
      n.relations.some(r => r.type === 'evaluated_by')
    )
      fail('proposed 尝试不能声明已实验验证');
    if (!Array.isArray(n.relations)) fail('relations 必须为数组');
    if (!nonempty(n.content)) fail('节点正文不能为空');
  }
  for (const n of nodes)
    for (const r of Array.isArray(n.relations) ? n.relations : []) {
      const prefix = `${n.id} --${r?.type}--> ${r?.to}`;
      if (!object(r) || !nonempty(r.type) || !nonempty(r.to)) {
        errors.push(`${n.id}: 非法关系`);
        continue;
      }
      const rule = SCHEMA.relations[r.type];
      const target = byId.get(r.to);
      if (!rule) {
        errors.push(`${prefix}: 未知关系`);
        continue;
      }
      if (!target) {
        errors.push(`${prefix}: 悬空引用`);
        continue;
      }
      if (r.to === n.id) errors.push(`${prefix}: 不允许自引用`);
      if (!rule.from.includes(n.type) || !rule.to.includes(target.type))
        errors.push(`${prefix}: 不合法的实体类型组合 ${n.type}/${target.type}`);
      if (rule.same_type && n.type !== target.type) errors.push(`${prefix}: 取代必须发生在同类实体之间`);
      if (r.type === 'supersedes' && target.status !== 'superseded')
        errors.push(`${prefix}: 被取代节点 status 应为 superseded，实际为 ${target.status}`);
      if (r.attributes !== undefined && (!object(r.attributes) || Object.values(r.attributes).some(v => !nonempty(v))))
        errors.push(`${prefix}: attributes 必须为非空字符串值对象`);
      for (const k of rule.required_attributes ?? [])
        if (!nonempty(r.attributes?.[k])) errors.push(`${prefix}: 缺少关系属性 ${k}`);
      if (n.relations.filter(x => x.type === r.type && x.to === r.to).length > 1) errors.push(`${prefix}: 重复关系`);
    }
  if (errors.length) throw new Error(`知识图谱校验失败，未生成文件：\n${errors.join('\n')}`);
}

export function build(
  root = resolve(HERE, '../../docs/knowledge'),
  checkOnly = false,
  checkGenerated = false
): { nodes: number; edges: number } {
  const nodeDir = resolve(root, 'nodes');
  const nodes = readdirSync(nodeDir)
    .filter(f => f.endsWith('.md'))
    .sort()
    .map(f => parseEntity(f, readFileSync(resolve(nodeDir, f), 'utf8')));
  validateGraph(nodes);
  const byId = new Map(nodes.map(n => [n.id, n]));
  const edges = nodes.flatMap(n => n.relations.map(r => ({ from: n.id, ...r })));
  if (!checkOnly || checkGenerated) {
    const link = (n: Entity) => `[${n.title}](nodes/${n.file})`;
    const describe = (n: Entity) =>
      `${link(n)} · \`${n.status}\`${n.outcome ? ` · 结果：${n.outcome}` : ''}${n.record_completeness === 'summary_only' ? ' · **历史摘要，运行细节不完整**' : ''}`;
    const out = [
      '# 探索历史索引',
      '',
      '> 自动生成：修改 nodes/ 后运行 `pnpm -s knowledge`。',
      '',
      `实体 ${nodes.length} 个 · 关系 ${edges.length} 条 · schema v${SCHEMA.version}`,
      '',
      '开工前对照：相关尝试 → 实验与经验 → 可复用机制 → 本轮变化与新信息。局部通过不等于组合通过。',
      '',
      '[使用说明与模板](README.md) · [迁移说明](MIGRATION.md) · [机器可读图谱](graph.json)',
      '',
      '## 按任务查',
      '',
    ];
    const types = Object.keys(SCHEMA.entities);
    for (const task of [...new Set(nodes.flatMap(n => n.tasks))].sort()) {
      out.push(`### ${task}`, '');
      for (const type of types) {
        const group = nodes.filter(n => n.type === type && n.tasks.includes(task));
        if (group.length) out.push(`- **${SCHEMA.entities[type].label}**：${group.map(describe).join(' · ')}`);
      }
      out.push('');
    }
    out.push('## 时间线：尝试、实验与决定', '');
    for (const n of nodes
      .filter(n => ['attempt', 'experiment', 'decision'].includes(n.type))
      .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)))
      out.push(`- ${n.date} · ${SCHEMA.entities[n.type].label} · ${describe(n)}`);
    out.push('', '## 全部实体与双向关系', '');
    for (const type of types) {
      out.push(`### ${SCHEMA.entities[type].label}`, '');
      for (const n of nodes.filter(n => n.type === type)) {
        out.push(`- ${describe(n)} · \`${n.id}\``, `  - 范围：${n.scope}`, `  - 来源性质：${n.evidence_origin}`);
        if (n.conditions.length) out.push(`  - 条件：${n.conditions.join('；')}`);
        if (n.invalidates_when) out.push(`  - 失效条件：${n.invalidates_when}`);
        for (const r of n.relations)
          out.push(
            `  - ${SCHEMA.relations[r.type].label} → ${link(byId.get(r.to)!)}${
              r.attributes
                ? `（${Object.entries(r.attributes)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join('；')}）`
                : ''
            }`
          );
        for (const e of edges.filter(e => e.to === n.id))
          out.push(
            `  - 入边 \`${e.type}\` ← ${link(byId.get(e.from)!)}${
              e.attributes
                ? `（${Object.entries(e.attributes)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join('；')}）`
                : ''
            }`
          );
      }
      out.push('');
    }
    const generated = {
      'INDEX.md': out.join('\n'),
      'graph.json': JSON.stringify(
        { schema_version: SCHEMA.version, entities: nodes.map(({ relations, ...n }) => n), relations: edges },
        null,
        2
      ) + '\n',
    };
    if (checkGenerated) {
      const stale = Object.entries(generated)
        .filter(([file, expected]) => !existsSync(resolve(root, file)) || readFileSync(resolve(root, file), 'utf8') !== expected)
        .map(([file]) => file);
      if (stale.length) throw new Error(`知识库生成文件缺失或过期：${stale.join('、')}。运行 pnpm -s knowledge 更新。`);
    } else {
      // Full validation completes before either generated file is touched.
      for (const [file, content] of Object.entries(generated)) writeFileSync(resolve(root, file), content);
    }
  }
  return { nodes: nodes.length, edges: edges.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.some(a => !['--check', '--check-generated'].includes(a))) throw new Error('仅支持 --check / --check-generated（只校验，不写文件）');
    const checkOnly = args.includes('--check') || args.includes('--check-generated');
    const counts = build(undefined, checkOnly, args.includes('--check-generated'));
    console.log(
      `[knowledge] ${counts.nodes} 实体 / ${counts.edges} 关系${checkOnly ? ' 校验通过' : ' → INDEX.md + graph.json'}`
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
