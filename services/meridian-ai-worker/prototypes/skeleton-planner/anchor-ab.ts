/**
 * A/B：给合成输入加「事件分组锚点」，章节数会变吗？
 *
 * 两臂只差**输入拼装方式**，prompt 用生产同一份 getBriefGenerationPrompt，
 * 模型/温度也和生产一致（glm-4.7-flash / 0.7）。
 *
 *   A 扁平（生产现状）  # [story k/25] ...          模型不知道有几个独立事件
 *   B 带锚点            # [event i/11 · story j/k]  同事件的 story 相邻，开头声明事件数
 *
 * 跑：pnpm -F meridian-ai-worker prototype:anchor [repeats]
 *
 * ⚠️ 已知污染：cluster 35 把伊朗战争 / 委内瑞拉石油 / 叙利亚 SDF / 叙利亚 Visa 卡
 * 糊成一个 cluster。所以 B 臂喂进去的「11 个事件」本身是脏的，真实约 14-15 个。
 * 这个原型顺带就是在测「脏锚点比没锚点好还是更糟」。
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBriefGenerationPrompt } from '../../src/prompts/briefGeneration.ts';

const here = dirname(fileURLToPath(import.meta.url));
const AI = process.env.AI_WORKER_URL ?? 'https://meridian-ai-worker.swj299792458.workers.dev';
const REPEATS = Number(process.argv[2] ?? 3);

// 生产的 slug 只把空格换横线，标点原样保留（story-us-israel-war-on-iran,-six-months-on）
const slug = (t: string) => 'story-' + t.toLowerCase().replace(/\s+/g, '-');

const cmap: { c: number; t: string }[] = JSON.parse(readFileSync(join(here, 'fixtures/clusters-75.json'), 'utf8')).map;
const reports = readdirSync(join(here, 'fixtures/intel-75'))
  .filter((f) => f.endsWith('.json'))
  .sort((a, b) => Number(a.split('.')[0]) - Number(b.split('.')[0]))
  .map((f) => JSON.parse(readFileSync(join(here, 'fixtures/intel-75', f), 'utf8')));

// intel report ↔ cluster：靠 storyId(slug) 对上 brief_stories 的标题
const clusterOf = (r: any): number => {
  const hit = cmap.find((m) => slug(m.t) === r.storyId);
  return hit ? hit.c : -1;
};
const matched = reports.filter((r) => clusterOf(r) >= 0).length;

/** 复刻生产 convertReportsToMarkdown 的主要区块（两臂共用，差异只在标题行） */
function body(r: any): string {
  let s = '';
  const tl = r.timeline;
  if (Array.isArray(tl) && tl.length) {
    s += '## 时间线（事件按此时间戳顺序发生，叙述时序/因果必须与此一致，不得重排）\n';
    tl.forEach((e: any) => { const ts = e.timestamp || e.date || ''; s += ts ? `* [${ts}] ${e.description}\n` : `* ${e.description}\n`; });
    s += '\n';
  }
  if (r.factualBasis?.length) {
    s += '## 关键发展\n';
    r.factualBasis.forEach((f: any) => { s += `* ${typeof f === 'string' ? f : JSON.stringify(f)}\n`; });
    s += '\n';
  }
  const ents = r.entities?.length ? r.entities : r.keyEntities;
  if (Array.isArray(ents) && ents.length) {
    s += '## 相关方（角色与言行须严格对应，勿张冠李戴）\n';
    ents.forEach((e: any) => { s += `* ${e.name}${e.role || e.type ? ` (${e.role || e.type})` : ''}${e.description ? `：${e.description}` : ''}\n`; });
    s += '\n';
  }
  if (r.significance) s += `## 意义\n${typeof r.significance === 'string' ? r.significance : JSON.stringify(r.significance)}\n\n`;
  return s;
}

function armFlat(): string {
  const n = reports.length;
  return reports.map((r, i) => (i ? '\n---\n\n' : '') + `# [story ${i + 1}/${n}] ${r.executiveSummary}\n\n` + body(r)).join('');
}

function armAnchored(): string {
  const groups = new Map<number, any[]>();
  for (const r of reports) {
    const c = clusterOf(r);
    if (!groups.has(c)) groups.set(c, []);
    groups.get(c)!.push(r);
  }
  const ordered = [...groups.entries()];
  const M = ordered.length;
  let out =
    `> 今天的报告覆盖 **${M} 个彼此独立的事件**。下面每份报告都标了它属于哪个事件：\n` +
    `> \`[event i/${M} · story j/k]\` —— 同一个 event 下的 k 份报告讲的是同一件事的不同侧面，\n` +
    `> 不同 event 之间没有预设关系，是否存在因果主线由你判断。\n` +
    `> 这 ${M} 个事件是输入规模的事实，不是章节数配额。\n\n`;
  ordered.forEach(([, rs], gi) => {
    rs.forEach((r, ri) => {
      out += (gi || ri ? '\n---\n\n' : '') + `# [event ${gi + 1}/${M} · story ${ri + 1}/${rs.length}] ${r.executiveSummary}\n\n` + body(r);
    });
  });
  return out;
}

/**
 * arm C：不给任何外部分组，让模型自己从 25 条摘要里推因果关系并分节。
 * 判据抄自生产 prompt 的 SECTION STRUCTURE（因果主线，不是主题桶）。
 */
function planPrompt(): string {
  const list = reports.map((r, i) => `[${i + 1}] ${r.executiveSummary}`).join('\n\n');
  return `below are ${reports.length} intelligence reports from today. decide the SECTION
structure of the brief. do not write the brief.

${list}

a section is a real through-line: several reports that genuinely belong together through a
shared conflict, a shared mechanism, or a shared consequence. it is NOT a topic bucket.

- if two reports share only a country or a topic word but nothing causal, they belong in
  DIFFERENT sections.
- a heading that could sit on any day's brief ("technology", "world news", "geopolitics")
  is a failed heading. name the section after what actually happened.
- some reports describe the same single event from different angles — put those together.
- there is no target number of sections. derive it from the material.
- for each section, state the causal link in one clause: what makes these one story.

output json only:
{"sections":[{"heading":"...","causalLink":"...","reports":[1,4,9]}]}
every report index 1-${reports.length} must appear exactly once.`;
}

function planToGuidance(plan: any): string {
  if (!plan?.sections?.length) return '';
  const lines = plan.sections.map((s: any, i: number) =>
    `${i + 1}. ## ${s.heading}  —— ${s.causalLink}  [reports: ${(s.reports ?? []).join(', ')}]`
  );
  return `> 结构已经规划好，按它写。每个 \`##\` 章节对应下面一条，章节内每份报告若无从属关系\n` +
    `> 就各自成块（\`<u>**...**</u>\`）。这不是建议，是本期的骨架：\n>\n` +
    lines.map((l: string) => '> ' + l).join('\n') + '\n\n';
}

async function chat(prompt: string, temp: number, maxTokens: number): Promise<string> {
  const res = await fetch(`${AI}/meridian/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: prompt }],
      options: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: temp, max_tokens: maxTokens, skipCache: true },
    }),
  });
  const j: any = await res.json();
  if (!res.ok || j?.success === false) throw new Error(j?.error ?? `HTTP ${res.status}`);
  return j?.data?.choices?.[0]?.message?.content ?? '';
}

function parsePlan(raw: string): any {
  for (const c of [raw.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1], raw.match(/\{[\s\S]*\}/)?.[0], raw]) {
    if (!c) continue;
    try { const o = JSON.parse(c.replace(/,\s*([}\]])/g, '$1')); if (Array.isArray(o?.sections)) return o; } catch {}
  }
  return null;
}

async function gen(md: string): Promise<string> {
  const res = await fetch(`${AI}/meridian/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [{ role: 'user', content: getBriefGenerationPrompt(md, '') }],
      options: { provider: 'workers-ai', model: '@cf/zai-org/glm-4.7-flash', temperature: 0.7, max_tokens: 16000, skipCache: true },
    }),
  });
  const j: any = await res.json();
  if (!res.ok || j?.success === false) throw new Error(j?.error ?? `HTTP ${res.status}`);
  let c = j?.data?.choices?.[0]?.message?.content ?? '';
  if (c.includes('<final_brief>')) c = c.split('<final_brief>')[1]?.split('</final_brief>')[0]?.trim() || c;
  return c;
}

function measure(brief: string) {
  const heads = [...brief.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  const main = heads.filter((h) => !/noteworthy/i.test(h));
  return { sections: main.length, blocks: (brief.match(/<u>/g) ?? []).length, chars: brief.length, headings: main };
}

/**
 * arm D：分段写。规划复用 C（实测它能推出 14-15 条主线），改的是写作——
 * 每个章节一次独立调用，各自拿满自己的输出预算，最后拼起来。
 * 验的是：约 3900 token 的自我预算是「每次调用」的，还是「每份简报」的。
 */
async function armSectioned(): Promise<string> {
  const plan = parsePlan(await chat(planPrompt(), 0, 4000));
  if (!plan?.sections?.length) throw new Error('规划解析失败');

  const writeOne = async (sec: any): Promise<string> => {
    const idxs: number[] = (sec.reports ?? []).filter((n: any) => Number.isInteger(n) && n >= 1 && n <= reports.length);
    if (!idxs.length) return '';
    const src = idxs.map((n) => `# [story ${n}] ${reports[n - 1].executiveSummary}\n\n` + body(reports[n - 1])).join('\n---\n\n');
    const prompt = `you are writing ONE section of today's intelligence brief. do not write other sections.

section heading: ${sec.heading}
what makes these one story: ${sec.causalLink}

source reports for this section:

${src}

write:
## ${sec.heading}
then, for EACH source report above that is a distinct development, one analysis block:
<u>**a short title capturing that development**</u>
followed by flowing paragraphs — what happened, why it matters, key context, and your
analytical take. use **bold** for names/places/numbers.

only merge two reports into one block if one is genuinely a facet of the other (same event,
different angle). reports that merely share a country or topic get their own blocks.
do not add a noteworthy section. do not write any other \`##\` heading.
output the section markdown only.`;
    return await chat(prompt, 0.7, 4000);
  };

  // 限并发 4，避免把 gateway 打爆
  const out: string[] = new Array(plan.sections.length).fill('');
  const q = plan.sections.map((sec: any, i: number) => ({ sec, i }));
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (;;) {
      const j = q.shift(); if (!j) return;
      try { out[j.i] = await writeOne(j.sec); } catch { out[j.i] = ''; }
    }
  }));
  return { text: out.filter(Boolean).join('\n\n'), planned: plan.sections.length } as any;
}

const A = armFlat(), B = armAnchored();
console.log(`输入：25 份情报报告，${matched}/25 对上 cluster，共 ${new Set(reports.map(clusterOf)).size} 个事件`);
console.log(`A 扁平 ${A.length} 字符   B 带锚点 ${B.length} 字符`);
console.log(`生产第 75 期实际：1 个主线章节 / 3 个块\n`);

const jobs: { arm: 'A' | 'B' | 'C' | 'D'; run: number }[] = [];
for (let r = 1; r <= REPEATS; r++) { jobs.push({ arm: 'A', run: r }); jobs.push({ arm: 'C', run: r }); jobs.push({ arm: 'D', run: r }); }
const out: any[] = [];
let done = 0;
const q = [...jobs];
await Promise.all(Array.from({ length: 3 }, async () => {
  for (;;) {
    const j = q.shift(); if (!j) return;
    try {
      if (j.arm === 'D') {
        const r: any = await armSectioned();
        out.push({ ...j, planSections: r.planned, ...measure(r.text) });
      } else if (j.arm === 'C') {
        const plan = parsePlan(await chat(planPrompt(), 0, 4000));
        const md = planToGuidance(plan) + A;   // 计划在前，正文输入沿用扁平那份
        out.push({ ...j, planSections: plan?.sections?.length ?? -1, ...measure(await gen(md)) });
      } else {
        out.push({ ...j, ...measure(await gen(j.arm === 'A' ? A : B)) });
      }
    }
    catch (e) { out.push({ ...j, err: e instanceof Error ? e.message : String(e) }); }
    process.stderr.write(`\r${++done}/${jobs.length}`);
  }
}));
process.stderr.write('\n\n');

for (const arm of ['A', 'C', 'D'] as const) {
  const rs = out.filter((r) => r.arm === arm && !r.err);
  const label = arm === 'A' ? 'A 扁平（生产现状）' : arm === 'C' ? 'C 先规划再一次写完' : 'D 先规划再分段写（每节一次调用）';
  console.log(`\x1b[1m${label}\x1b[0m  成功 ${rs.length}/${REPEATS}`);
  if (!rs.length) { console.log('  全失败:', out.filter((r) => r.arm === arm)[0]?.err); continue; }
  if (arm === 'C' || arm === 'D') console.log(`  计划里的章节数 ${rs.map((r: any) => r.planSections).join(', ')}`);
  console.log(`  主线章节数 ${rs.map((r) => r.sections).join(', ')}`);
  console.log(`  故事块数   ${rs.map((r) => r.blocks).join(', ')}`);
  console.log(`  正文字符   ${rs.map((r) => r.chars).join(', ')}`);
  rs.forEach((r, i) => console.log(`  \x1b[2m#${i + 1} 标题: ${r.headings.join(' | ')}\x1b[0m`));
  console.log('');
}
