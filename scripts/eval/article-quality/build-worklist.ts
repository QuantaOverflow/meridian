// ============================================================================
// 文章质量门 worklist 生成器
//
// 输入：一个候选文章 JSONL，每行 {id, title, content, url?}。
//   ⚠️ 数据来源（重要，见 README §数据来源）：
//   现【没有】现成 backend 端点能一次拉「已打分文章 + 正文」（admin /articles 不带
//   content_quality；observability 也不暴露文章级分析）。且历史 article_analysis LLM
//   调用没落 R2（workflow 调用未传 traceId）。所以候选文章要由用户从 DB + R2 自行导出成
//   JSONL（SQL 取 id/title/url + content_quality 旧分用于分层，R2 按 contentFileKey 取正文）。
//   导出方法见 README。本脚本只负责：现打分 → 分层 → 出盲标表。
//
// 流程：读候选 → 调 /meridian/article/analyze 现打分 → 按门边界分层（过采 REJECT 与
//   边界类 PARTIAL_USEFUL / LOW_QUALITY，否则盲标表全是 OK/COMPLETE，召回算不出来）→ 出两文件：
//   - worklist/<batch>.blind.jsonl   {id,title,content,url,strata, gold_content_quality:'', gold_completeness:''}  ← 给标注者
//   - worklist/<batch>.pred.jsonl    {id, pred_content_quality, pred_completeness, pred_gate}                      ← 旁车，仅 critic 对比
//
// 标注者照 ./rubric.md 在 blind 表上填 gold 两维度 → 汇总裁定 → gold/quality-gold.jsonl → pnpm meta。
//
// 用法：
//   pnpm worklist <candidates.jsonl>
//   env: AI_WORKER_URL, WORKLIST_MAX(80), CONCURRENCY(4), BATCH(日期)
// ============================================================================

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { scoreArticle } from './scorer.js';
import { deriveGate } from './types.js';
import type { ArticleSample, ContentQuality, Completeness } from './types.js';

const WORKLIST_MAX = Number(process.env.WORKLIST_MAX ?? '80');
const CONCURRENCY = Number(process.env.CONCURRENCY ?? '4');
const BATCH = process.env.BATCH || new Date().toISOString().slice(0, 10);

interface Scored extends ArticleSample {
  pred_content_quality?: string;
  pred_completeness?: string;
  pred_gate?: string;
  error?: string;
}

function loadCandidates(path: string): ArticleSample[] {
  const raw = readFileSync(path, 'utf8');
  const out: ArticleSample[] = [];
  raw.split(/\r?\n/).forEach((line, i) => {
    const t = line.trim();
    if (!t || t.startsWith('#')) return;
    let o: any;
    try {
      o = JSON.parse(t);
    } catch {
      throw new Error(`候选第 ${i + 1} 行不是合法 JSON: ${t.slice(0, 80)}`);
    }
    if (!o.title || !o.content) {
      throw new Error(`候选第 ${i + 1} 行缺 title/content: ${t.slice(0, 80)}`);
    }
    out.push({ id: String(o.id ?? `cand-${i + 1}`), title: o.title, content: o.content, url: o.url });
  });
  return out;
}

async function scoreAll(samples: ArticleSample[]): Promise<Scored[]> {
  const out: Scored[] = new Array(samples.length);
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < samples.length) {
      const i = next++;
      const s = samples[i];
      const r = await scoreArticle(s.title, s.content, s.url);
      const cq = r.content_quality as ContentQuality | undefined;
      const comp = r.completeness as Completeness | undefined;
      const gate =
        cq && comp ? deriveGate({ content_quality: cq, completeness: comp }) : undefined;
      out[i] = {
        ...s,
        pred_content_quality: r.content_quality,
        pred_completeness: r.completeness,
        pred_gate: gate,
        error: r.error,
      };
      done++;
      if (done % 10 === 0 || done === samples.length) console.log(`  scored ${done}/${samples.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, samples.length) }, worker));
  return out;
}

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 边界样本：scorer 判 REJECT，或落在「中间档」(PARTIAL_USEFUL / LOW_QUALITY)——
// 这些是门校准最该看的（cutoff 卡对没卡对就看这层）。全收；OK+COMPLETE 的「干净 KEEP」补到 target。
function isBoundary(s: Scored): boolean {
  if (s.error) return false;
  if (s.pred_gate === 'REJECT') return true;
  if (s.pred_content_quality === 'LOW_QUALITY') return true; // REJECT 边界
  if (s.pred_completeness === 'PARTIAL_USEFUL') return true; // KEEP 但临近边界
  return false;
}

async function main() {
  const candPath = process.argv[2];
  if (!candPath) {
    console.error('用法: pnpm worklist <candidates.jsonl>（每行 {id,title,content,url?}）');
    console.error('候选导出方法见 README §数据来源。');
    process.exit(1);
  }
  console.log(`[worklist] candidates=${candPath} target≤${WORKLIST_MAX} concurrency=${CONCURRENCY}`);

  const cands = loadCandidates(candPath);
  console.log(`[worklist] 读到 ${cands.length} 篇候选，现打分（真实计费）...`);
  const scored = await scoreAll(cands);

  const errored = scored.filter((s) => s.error);
  const ok = scored.filter((s) => !s.error);
  const boundary = ok.filter(isBoundary);
  const clean = shuffle(ok.filter((s) => !isBoundary(s)));
  const cleanQuota = Math.max(0, WORKLIST_MAX - boundary.length);
  const picked = shuffle([...boundary, ...clean.slice(0, cleanQuota)]);

  mkdirSync('worklist', { recursive: true });
  const blindPath = `worklist/${BATCH}.blind.jsonl`;
  const predPath = `worklist/${BATCH}.pred.jsonl`;
  const blindLines = picked.map((s) =>
    JSON.stringify({
      id: s.id,
      title: s.title,
      content: s.content,
      url: s.url,
      strata: {},
      gold_content_quality: '',
      gold_completeness: '',
      note: '',
    })
  );
  const predLines = picked.map((s) =>
    JSON.stringify({
      id: s.id,
      pred_content_quality: s.pred_content_quality,
      pred_completeness: s.pred_completeness,
      pred_gate: s.pred_gate,
    })
  );
  writeFileSync(blindPath, blindLines.join('\n') + '\n');
  writeFileSync(predPath, predLines.join('\n') + '\n');

  const byGate: Record<string, number> = {};
  for (const s of picked) byGate[s.pred_gate ?? 'unknown'] = (byGate[s.pred_gate ?? 'unknown'] ?? 0) + 1;
  console.log(
    `\n[worklist] 候选 ${cands.length} → 选 ${picked.length}（边界全收 ${boundary.length}，干净 KEEP 补 ${Math.min(cleanQuota, clean.length)}，打分报错 ${errored.length} 弃）`
  );
  console.log(`  scorer 预测门分布(分层依据，非 gold): ${Object.entries(byGate).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  console.log(`  盲标表 → ${blindPath}（给标注者，照 rubric.md 填两维度 gold）`);
  console.log(`  scorer 旁车 → ${predPath}（仅 critic 对比）`);
  console.log(`\n下一步：标注者填 gold → 汇总裁定 → gold/quality-gold.jsonl → pnpm meta`);
}

main().catch((e) => {
  console.error('worklist 生成失败:', e);
  process.exit(1);
});
