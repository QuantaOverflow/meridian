/**
 * 一次性 TUI 外壳。逻辑全在 skeleton.ts，这里只负责按键、调 LLM、重画一屏。
 * 跑：pnpm -F meridian-ai-worker prototype:skeleton
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildPrompt, parseSkeleton, validate, stats, SYSTEM,
  type DayInput, type Skeleton, type Issue, type Stats,
} from './skeleton.ts';

const here = dirname(fileURLToPath(import.meta.url));
const AI_WORKER = process.env.AI_WORKER_URL ?? 'https://meridian-ai-worker.swj299792458.workers.dev';

const B = (s: string) => `\x1b[1m${s}\x1b[0m`;
const D = (s: string) => `\x1b[2m${s}\x1b[0m`;
const R = (s: string) => `\x1b[31m${s}\x1b[0m`;
const G = (s: string) => `\x1b[32m${s}\x1b[0m`;
const Y = (s: string) => `\x1b[33m${s}\x1b[0m`;

const days: DayInput[] = readdirSync(join(here, 'fixtures'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(join(here, 'fixtures', f), 'utf8')))
  .sort((a, b) => a.reportId - b.reportId);

interface Run { skeleton: Skeleton | null; issues: Issue[]; st: Stats | null; raw: string; ms: number }

const state = {
  dayIdx: days.length - 1,
  temperature: 0,
  runs: [] as Run[],
  busy: false,
  note: '按 g 生成骨架',
};

const day = () => days[state.dayIdx];

async function callLLM(prompt: string, temperature: number): Promise<string> {
  const res = await fetch(`${AI_WORKER}/meridian/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: prompt },
      ],
      // provider/model 写死成生产 brief_generation 用的那一对——测的就是它。
      // /meridian/chat 默认 dashscope，而那把 key 已 401 失效。
      // skipCache 必须为 true：否则重复运行会拿到 Gateway 缓存的同一份答案，
      // 把「稳定」测成假象（见 memory: ai-gateway-cache-eval-trap）。
      options: {
        provider: 'workers-ai',
        model: '@cf/zai-org/glm-4.7-flash',
        temperature,
        max_tokens: 4000,
        skipCache: true,
      },
    }),
  });
  const j: any = await res.json();
  if (!res.ok || j?.success === false) throw new Error(j?.error ?? `HTTP ${res.status}`);
  return j?.data?.choices?.[0]?.message?.content ?? j?.data?.content ?? JSON.stringify(j).slice(0, 400);
}

async function generate() {
  state.busy = true; state.note = '调用中…'; render();
  const t0 = Date.now();
  try {
    const raw = await callLLM(buildPrompt(day()), state.temperature);
    const sk = parseSkeleton(raw);
    state.runs.push({
      skeleton: sk,
      issues: sk ? validate(sk, day()) : [{ level: 'error', message: 'JSON 解析失败' }],
      st: sk ? stats(sk, day()) : null,
      raw,
      ms: Date.now() - t0,
    });
    state.note = '完成';
  } catch (e) {
    state.note = R(`失败: ${e instanceof Error ? e.message : String(e)}`);
  }
  state.busy = false; render();
}

function render() {
  console.clear();
  const d = day();
  const last = state.runs[state.runs.length - 1];

  console.log(B('骨架规划器原型') + D('  —— 不写死板块数、不写死块数下限，结构完全由内容决定'));
  console.log(D('问题：把骨架独立成一次 LLM 调用、且不给任何数量配额，产出的粒度合理吗？跨次稳定吗？'));
  console.log('');
  console.log(B(`输入  `) + `第 ${d.reportId} 期  ` + D(`${d.storyRows} 条 story 行 → `) +
    B(`${d.events.length} 个去重事件`) + D(`   生产实际写出 ${d.actualBlocksInBrief} 块`));
  console.log(B(`温度  `) + state.temperature + D('   （t 切换 0 / 0.7）') +
    B('   已跑  ') + state.runs.length + ' 次');
  console.log('');

  if (last?.skeleton && last.st) {
    const s = last.st;
    const ratio = s.blockRatio;
    const tag = ratio >= 0.8 ? G('接近 1:1') : ratio >= 0.5 ? Y('中度合并') : R('重度压缩');
    console.log(B('最近一次结果') + D(`  ${last.ms}ms`));
    console.log(`  板块 ${B(String(s.sections))}   独立块 ${B(String(s.blocks))}/${s.events}  ` +
      `折叠 ${s.folded}   短讯 ${s.noteworthy}`);
    console.log(`  ${B('块/事件')} ${ratio.toFixed(2)}  ${tag}` +
      D(`      每板块块数 [${s.blocksPerSection.join(', ')}]`));
    console.log('');
    for (const sec of last.skeleton.sections) {
      const blocks = sec.placements.filter((p) => p.form === 'block');
      console.log(`  ${B('##')} ${sec.heading} ${D(`(${blocks.length} 块)`)}`);
      console.log(D(`      主线: ${sec.throughLine}`));
      for (const p of sec.placements) {
        if (p.form === 'block') console.log(`      ${G('■')} [${p.clusterId}] ${p.title ?? ''}`);
        else console.log(D(`      └ [${p.clusterId}] folded → ${p.into}  ${p.why ?? ''}`));
      }
    }
    if (last.skeleton.noteworthy.length) {
      console.log(`  ${B('##')} noteworthy ${D(`[${last.skeleton.noteworthy.join(', ')}]`)}`);
    }
    console.log('');
    const errs = last.issues.filter((i) => i.level === 'error');
    const warns = last.issues.filter((i) => i.level === 'warn');
    console.log(B('校验  ') + (errs.length ? R(`${errs.length} 错`) : G('0 错')) +
      '  ' + (warns.length ? Y(`${warns.length} 警`) : D('0 警')));
    for (const i of [...errs, ...warns].slice(0, 6)) {
      console.log(`  ${i.level === 'error' ? R('✗') : Y('!')} ${i.message}`);
    }
  } else if (last) {
    console.log(R('解析失败，原始输出前 500 字：'));
    console.log(D(last.raw.slice(0, 500)));
  }

  if (state.runs.length > 1) {
    console.log('');
    console.log(B('跨次方差') + D('  （同输入重复跑，看结构稳不稳）'));
    const rows = state.runs.map((r, i) =>
      `  #${i + 1}  板块 ${r.st?.sections ?? '-'}  块 ${r.st?.blocks ?? '-'}  ` +
      `比 ${r.st ? r.st.blockRatio.toFixed(2) : '-'}  ${r.issues.filter((x) => x.level === 'error').length} 错`);
    console.log(rows.join('\n'));
    const bs = state.runs.map((r) => r.st?.blocks).filter((x): x is number => x !== undefined);
    if (bs.length > 1) console.log(D(`  块数范围 ${Math.min(...bs)}–${Math.max(...bs)}`));
  }

  console.log('');
  console.log(D('─'.repeat(72)));
  console.log(state.busy ? Y(state.note) : state.note);
  console.log(`${B('[g]')}${D(' 生成')}  ${B('[d]')}${D(' 换一天')}  ${B('[t]')}${D(' 切温度')}  ` +
    `${B('[c]')}${D(' 清空历史')}  ${B('[r]')}${D(' 看原始输出')}  ${B('[q]')}${D(' 退出')}`);
}

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');
process.stdin.on('data', async (key: string) => {
  if (state.busy) return;
  if (key === 'q' || key === '') { console.clear(); process.exit(0); }
  if (key === 'g') return generate();
  if (key === 'd') { state.dayIdx = (state.dayIdx + 1) % days.length; state.runs = []; state.note = '换了一天，历史已清'; }
  if (key === 't') { state.temperature = state.temperature === 0 ? 0.7 : 0; state.runs = []; state.note = '换了温度，历史已清'; }
  if (key === 'c') { state.runs = []; state.note = '历史已清'; }
  if (key === 'r') {
    const last = state.runs[state.runs.length - 1];
    if (last) { console.clear(); console.log(last.raw); console.log(D('\n按任意键返回')); return; }
  }
  render();
});

render();
