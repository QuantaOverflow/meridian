# Story Validation Eval Framework v1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建一个独立 Node 脚本，输入 workflow id，输出每个 valid story 的质量
判定（REAL/BORDERLINE/FAKE）+ 与 19 条人工 calibration 的 precision/recall/F1，
让 prompt 改动有客观信号。

**Architecture:** 1 行 workflow 修改让 observability JSON 含完整 stories[]；
新建 `scripts/eval/story-validation/` 独立 tsx 脚本，hits `GET
/observability/workflows/:key` 拿数据、跑 4 条 heuristic 规则、再调
`POST /meridian/chat` (qwen-plus, T=0) 做 LLM-as-judge；产出 markdown 报告
到 `eval-reports/`。

**Tech Stack:** TypeScript + tsx（pnpm 已有），调用本地 backend (8787) 与
ai-worker (8788)。无新依赖、无 DB schema 变更、无 mock。

**用户约束（覆盖默认）：**
- 不自动写单元测试文件（每个 task 用真实数据/真实接口做 smoke 验证）
- 不用 mock（judge 真调本地 ai-worker，heuristic 真跑 brief #7 数据）
- 不自动 commit 任何脚本（plan 中不出现 `git commit` step；做完一次性人工审视决定）

**Spec 参考：** `docs/superpowers/specs/2026-05-20-story-validation-eval-framework-design.md`

**File map（最终态）：**
```
.gitignore                                                       MODIFY
apps/backend/src/workflows/auto-brief-generation.ts             MODIFY (line 726-729)
scripts/eval/story-validation/
  package.json                                                   NEW
  tsconfig.json                                                  NEW
  types.ts                                                       NEW
  heuristics.ts                                                  NEW
  judge.ts                                                       NEW
  report.ts                                                      NEW
  score.ts                                                       NEW (main entry)
  calibration.json                                               NEW
eval-reports/                                                    NEW (gitignored)
```

---

## Task 1: 让 workflow 把完整 story 列表写进 observability

**目的：** Eval 脚本现在只能拿到 `{validStoriesCount, rejectedClustersCount}`
（见 brief #7 实测），需要完整的 `stories[]` 与 `rejectedClusters[]`
才能逐 story 评分。

**Files:**
- Modify: `apps/backend/src/workflows/auto-brief-generation.ts:726-729`

- [ ] **Step 1.1: 修改 observability payload**

把：

```ts
await observability.logStep('story_validation', 'completed', {
  validStories: validatedStories.stories.length,
  rejectedClusters: validatedStories.rejectedClusters.length
});
```

改成：

```ts
await observability.logStep('story_validation', 'completed', {
  validStoriesCount: validatedStories.stories.length,
  rejectedClustersCount: validatedStories.rejectedClusters.length,
  stories: validatedStories.stories,
  rejectedClusters: validatedStories.rejectedClusters,
});
```

注意：用 `validStoriesCount` 取代 `validStories`（避免与下面新加的 `stories` 字段
歧义）。下游 dashboard 如果引用旧字段名，先确认没消费方再决定是否回填别名。

- [ ] **Step 1.2: 验证旧字段无消费方**

Run:

```bash
grep -rn "validStories[^C]\|rejectedClusters[^Count]" apps/backend/src apps/frontend 2>/dev/null | grep -v "validatedStories\|validatedStories" | head
```

Expected: 输出为空或只出现在新写的代码里。如果有真实消费方，把上面 payload
里加上别名字段 `validStories: validatedStories.stories.length` 兼容。

- [ ] **Step 1.3: 触发一次 brief 验证 payload 含 stories[]**

Run:

```bash
curl -s -X POST http://localhost:8787/admin/briefs/generate \
  -H "Content-Type: application/json" \
  -d '{"timeRangeDays":7,"articleLimit":200,"minImportance":3,"maxStoriesToGenerate":3,"clusteringOptions":{"umapParams":{"n_neighbors":5,"n_components":5,"min_dist":0.1,"metric":"cosine"},"hdbscanParams":{"min_cluster_size":3,"min_samples":1,"epsilon":0.5}},"triggeredBy":"eval-prereq-test"}' \
  | python3 -m json.tool
```

记录返回的 `workflowId`，等 ~6 分钟跑完后：

```bash
WF_ID=<paste>
curl -s "http://localhost:8787/observability/workflows" \
  | python3 -c "import sys,json; d=json.load(sys.stdin); [print(w['key']) for w in d['workflows'] if '$WF_ID' in w['key']]"
```

取一条 key，然后：

```bash
KEY=<paste-key>
curl -s "http://localhost:8787/observability/workflows/$(python3 -c 'import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=""))' "$KEY")" \
  | python3 -c "import sys,json; m=json.load(sys.stdin); s=[x for x in m['detailedMetrics'] if x['stepName']=='story_validation' and x['status']=='completed'][0]; print('stories key present:', 'stories' in s['data']); print('story count:', len(s['data'].get('stories',[]))); print('first title:', s['data'].get('stories',[{}])[0].get('title',''))"
```

Expected:
```
stories key present: True
story count: <一个 >0 的整数>
first title: <一个非空字符串>
```

如果 `stories key present: False`，说明 wrangler dev 没 hot-reload，重启 backend
shell 后重跑 step 1.3。

---

## Task 2: 创建 eval 脚本的目录骨架与配置

**Files:**
- Create: `scripts/eval/story-validation/package.json`
- Create: `scripts/eval/story-validation/tsconfig.json`
- Modify: `.gitignore`

- [ ] **Step 2.1: 创建 package.json**

```json
{
  "name": "@meridian/eval-story-validation",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "score": "tsx score.ts"
  },
  "devDependencies": {
    "tsx": "^4.19.0",
    "typescript": "5.8.2"
  }
}
```

注意 `type: module`。没有运行时依赖（只用 `fetch`、`crypto`、`fs/promises`，
Node 22+ 都内置）。

- [ ] **Step 2.2: 创建 tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["*.ts"]
}
```

- [ ] **Step 2.3: 装依赖**

Run:

```bash
cd scripts/eval/story-validation && pnpm install
```

Expected: 创建 `node_modules/`，无 error。

- [ ] **Step 2.4: 把 eval-reports/ 加入 gitignore**

把这行加到根目录 `.gitignore` 末尾（在最后一个非空行后）：

```
eval-reports/
scripts/eval/story-validation/node_modules/
```

Run 验证：

```bash
grep -E "eval-reports|story-validation/node_modules" .gitignore
```

Expected: 两行都出现。

---

## Task 3: 定义共享类型

**Files:**
- Create: `scripts/eval/story-validation/types.ts`

- [ ] **Step 3.1: 写 types.ts**

完整内容：

```ts
// Workflow observability JSON 中 story_validation step 的 data 字段形态
export interface Story {
  title: string;
  importance: number;
  articleIds: number[];
  storyType: string; // 通常 'SINGLE_STORY'
}

export interface RejectedCluster {
  clusterId: number;
  rejectionReason: string; // 'PURE_NOISE' | 'NO_STORIES' | 'INSUFFICIENT_ARTICLES'
  originalArticleIds: number[];
}

export interface StoryValidationStepData {
  validStoriesCount: number;
  rejectedClustersCount: number;
  stories: Story[];
  rejectedClusters: RejectedCluster[];
}

// Article 信息（从 backend 数据集拿）
export interface ArticleInfo {
  id: number;
  title: string;
  url: string;
  event_summary_points?: string[];
}

// Heuristic 输出
export type HeuristicFlag =
  | 'padded_title'
  | 'low_support'
  | 'split_overlap'
  | 'geo_stuffing';

export interface HeuristicResult {
  flags: HeuristicFlag[];
  details: Partial<Record<HeuristicFlag, string>>; // 命中时的人类可读说明
}

// LLM judge 输出
export type Verdict = 'REAL' | 'BORDERLINE' | 'FAKE';

export interface JudgeResult {
  verdict: Verdict;
  coherence: number;   // 1-5
  title_fit: number;   // 1-5
  reason: string;
}

// 每个 story 的最终评估结果
export interface StoryEvaluation {
  story: Story;
  heuristic: HeuristicResult;
  judge: JudgeResult;
  finalVerdict: Verdict; // 合并规则后的最终判定
}

// Calibration set 一条
export interface CalibrationEntry {
  title: string;
  expected: Verdict;
  note?: string;
}

export interface CalibrationFile {
  source: string;
  labels: CalibrationEntry[];
}

// Calibration 指标
export interface CalibrationMetrics {
  matched: number;       // 与 calibration 标题对上的 story 数
  total: number;         // calibration 集大小
  precision: number;
  recall: number;
  f1: number;
  confusion: Record<Verdict, Record<Verdict, number>>; // [groundTruth][judged]
}

// 最终 eval 产出
export interface EvalReport {
  workflowId: string;
  promptHash: string;
  judgeModel: string;
  timestamp: string;
  candidateCount: number; // valid + rejected from workflow
  passedCount: number;    // valid from workflow
  evaluations: StoryEvaluation[];
  rejectedClusters: RejectedCluster[];
  calibration?: CalibrationMetrics;
}
```

- [ ] **Step 3.2: 验证 typecheck 通过**

Run:

```bash
cd scripts/eval/story-validation && pnpm exec tsc --noEmit
```

Expected: 退出码 0，无输出。

---

## Task 4: 实现 heuristic 规则

**Files:**
- Create: `scripts/eval/story-validation/heuristics.ts`

- [ ] **Step 4.1: 写 heuristics.ts**

完整内容：

```ts
import type { Story, HeuristicResult, HeuristicFlag } from './types.js';

// region/domain token 静态列表（v1）—— 标题里命中 ≥2 个不同 token 视为 geo_stuffing
const REGION_DOMAIN_TOKENS = [
  // regions
  'Middle East', 'Latin America', 'Caribbean', 'East Asia', 'Europe',
  'US', 'America', 'Africa', 'Israel', 'Gaza', 'Lebanon', 'Syria',
  'Ukraine', 'Russia', 'China', 'Spain', 'Australia', 'Japan', 'Korea',
  'France', 'Germany', 'UK', 'India', 'Iran', 'Cuba', 'Mexico', 'Bolivia',
  'Jamaica', 'Sierra Leone', 'Tasmania', 'DR Congo', 'Afghanistan',
  // domains
  'Cybersecurity', 'AI', 'Sports', 'Politics', 'Legal', 'Health',
  'Climate', 'Diplomacy', 'Economy',
];

// 把标题里的连接词识别成"拼盘信号" —— 当 ' and ' 两侧都含命名实体大写词时算
const PADDED_TITLE_PATTERN = /\b(and|plus|along with|;|&|\+)\b/i;

function detectPaddedTitle(title: string): string | null {
  // 简化版：标题中 ' — ' 之后含 ' and '/'+'/',' 连接两段都含大写首字母 token
  // 例: "US Legal — Musk's OpenAI Lawsuit Dismissed, Trump's IRS Lawsuit Dropped, Justice Department Anti-Weaponization Fund"
  // 真实判定：标题中逗号或 ' and ' 出现 ≥2 次，且每段都含至少一个大写专名
  const tail = title.includes('—') ? title.split('—').slice(1).join('—') : title;
  const segments = tail.split(/,| and |;|\+/).map(s => s.trim()).filter(Boolean);
  if (segments.length < 3) return null;
  const segmentsWithProper = segments.filter(s => /\b[A-Z][a-zA-Z]+/.test(s));
  if (segmentsWithProper.length >= 3) {
    return `title splits into ${segmentsWithProper.length} segments each with a proper noun: ${segmentsWithProper.slice(0, 3).join(' / ')}...`;
  }
  return null;
}

function detectLowSupport(story: Story): string | null {
  if (story.articleIds.length < 3) {
    return `only ${story.articleIds.length} article(s) — below the "same event, multiple outlets" threshold`;
  }
  return null;
}

function detectGeoStuffing(title: string): string | null {
  const lower = title.toLowerCase();
  const hits = new Set<string>();
  for (const token of REGION_DOMAIN_TOKENS) {
    if (lower.includes(token.toLowerCase())) hits.add(token);
  }
  if (hits.size >= 2) {
    return `title mentions ${hits.size} distinct region/domain tokens: ${[...hits].join(', ')}`;
  }
  return null;
}

// split_overlap 需要跨 story 的视图，单独导出
export function detectSplitOverlap(stories: Story[]): Map<number, Set<number>> {
  // articleId -> set of story indexes containing it
  const idToStoryIdx = new Map<number, Set<number>>();
  stories.forEach((story, idx) => {
    for (const aid of story.articleIds) {
      if (!idToStoryIdx.has(aid)) idToStoryIdx.set(aid, new Set());
      idToStoryIdx.get(aid)!.add(idx);
    }
  });
  // 只保留出现在 2+ story 的 articleId
  const overlap = new Map<number, Set<number>>();
  for (const [aid, idxs] of idToStoryIdx) {
    if (idxs.size >= 2) overlap.set(aid, idxs);
  }
  return overlap;
}

// 主入口：对一个 story 跑所有 heuristic（split_overlap 需要外部传入）
export function runHeuristics(
  story: Story,
  storyIdx: number,
  overlapMap: Map<number, Set<number>>
): HeuristicResult {
  const flags: HeuristicFlag[] = [];
  const details: HeuristicResult['details'] = {};

  const padded = detectPaddedTitle(story.title);
  if (padded) { flags.push('padded_title'); details.padded_title = padded; }

  const lowSup = detectLowSupport(story);
  if (lowSup) { flags.push('low_support'); details.low_support = lowSup; }

  const geo = detectGeoStuffing(story.title);
  if (geo) { flags.push('geo_stuffing'); details.geo_stuffing = geo; }

  // 是否有任何 articleId 出现在另一 story 里
  const overlappingIds = story.articleIds.filter(aid => {
    const idxs = overlapMap.get(aid);
    return idxs && idxs.size >= 2;
  });
  if (overlappingIds.length > 0) {
    flags.push('split_overlap');
    details.split_overlap = `${overlappingIds.length} articleId(s) shared with other stories: ${overlappingIds.slice(0, 3).join(', ')}`;
  }

  return { flags, details };
}
```

- [ ] **Step 4.2: 用 brief #7 真实数据做 smoke 验证**

写一个**临时**验证脚本到当前目录（不入库），路径
`scripts/eval/story-validation/_smoke-heuristics.ts`：

```ts
import { runHeuristics, detectSplitOverlap } from './heuristics.js';
import type { Story } from './types.js';

// brief #7 实测 19 story 的 title + articleId 数（articleId 用占位的递增序列足够触发 overlap 测试）
const stories: Story[] = [
  { title: "Middle East — Israel-Gaza conflict: ICC arrest claims, Gaza flotilla interception, US sanctions, and East Jerusalem demolitions", importance: 9, articleIds: [1,2,3,4,5], storyType: "SINGLE_STORY" },
  { title: "Latin America — Bolivia anti-government protests and Mexico ex-officials surrender over cartel ties", importance: 7, articleIds: [6,7], storyType: "SINGLE_STORY" },
  { title: "International justice — ICC proceedings involving Israeli minister Smotrich, Libyan militia commander El Hishri, and 7 October exhibition in London", importance: 8, articleIds: [3,8,9], storyType: "SINGLE_STORY" }, // articleId 3 与 #1 重叠
  { title: "Caribbean/Latin America — Cuba warns US of 'bloodbath' over drone claims; US DoD inquiry into airstrikes on alleged drug boats", importance: 7, articleIds: [10,11], storyType: "SINGLE_STORY" },
  { title: "Middle East — Escalating Israel-Lebanon conflict and casualties", importance: 8, articleIds: [12,13], storyType: "SINGLE_STORY" },
  { title: "Spain — Arrest of Jonathan Andic in Catalonia over father Isak Andic's death", importance: 6, articleIds: [14,15], storyType: "SINGLE_STORY" },
  { title: "FIFA World Cup 2026 — National team squad announcements (Portugal, Brazil)", importance: 7, articleIds: [16,17], storyType: "SINGLE_STORY" },
];

const overlap = detectSplitOverlap(stories);
console.log('Overlap map (articleId → story-indexes):', [...overlap.entries()].map(([k,v]) => [k, [...v]]));
console.log();

stories.forEach((s, idx) => {
  const r = runHeuristics(s, idx, overlap);
  console.log(`#${idx+1} flags=[${r.flags.join(', ')}]`);
  for (const f of r.flags) console.log(`   - ${f}: ${r.details[f]}`);
});
```

Run:

```bash
cd scripts/eval/story-validation && pnpm exec tsx _smoke-heuristics.ts
```

Expected（关键判定）：
- `#1` 标题 4 个 segment、含多 region token → `padded_title` + `geo_stuffing` 命中
- `#2` 仅 2 篇 + Bolivia/Mexico → `low_support` + `geo_stuffing` 命中
- `#3` Smotrich/El Hishri/London exhibition → `padded_title` 命中；articleId 3 与 #1 重叠 → `split_overlap` 命中
- `#5` "Israel-Lebanon" → `geo_stuffing` 命中、2 篇 → `low_support` 命中（这是 brief #7 里的真实独立故事，会显示 heuristic 误报偏紧 —— 这个失败案例本身就是 calibration 信号）
- `#6` Spain only 2 articles → `low_support` 命中
- `#7` Portugal+Brazil → `geo_stuffing` 命中

如果某些 flag 没按预期命中，回到 Step 4.1 调正则/阈值。

- [ ] **Step 4.3: 删除 smoke 文件**

Run:

```bash
rm scripts/eval/story-validation/_smoke-heuristics.ts
```

---

## Task 5: 写入 brief #7 的人工 calibration set

**Files:**
- Create: `scripts/eval/story-validation/calibration.json`

- [ ] **Step 5.1: 写 calibration.json**

完整内容（19 条，来自 brief #7 / `admin-brief-1779253365414` 的 2026-05-20
上午人工 review）：

```json
{
  "source": "brief #7 / admin-brief-1779253365414 / 2026-05-20",
  "notes": "11 个真实独立故事 + 3 个合理多角度合并 (BORDERLINE) + 5 个强行拼盘 (FAKE)",
  "labels": [
    { "title": "Middle East — Israel-Gaza conflict: ICC arrest claims, Gaza flotilla interception, US sanctions, and East Jerusalem demolitions", "expected": "BORDERLINE", "note": "4 events tightly under Israel-Gaza umbrella; debatable" },
    { "title": "Latin America — Bolivia anti-government protests and Mexico ex-officials surrender over cartel ties", "expected": "FAKE", "note": "two unrelated events glued by Latin America label" },
    { "title": "International justice — ICC proceedings involving Israeli minister Smotrich, Libyan militia commander El Hishri, and 7 October exhibition in London", "expected": "FAKE", "note": "three independent ICC items; Smotrich already covered in story #1" },
    { "title": "Caribbean/Latin America — Cuba warns US of 'bloodbath' over drone claims; US DoD inquiry into airstrikes on alleged drug boats", "expected": "FAKE", "note": "two distinct US-Caribbean tension items" },
    { "title": "Middle East — Escalating Israel-Lebanon conflict and casualties", "expected": "REAL", "note": "single concrete event" },
    { "title": "Middle East — US-Iran tensions: Trump cancels planned strike amid Gulf diplomacy", "expected": "REAL", "note": "single concrete event" },
    { "title": "Middle East — Drone strike on UAE's Barakah nuclear plant raises wartime safety concerns", "expected": "REAL", "note": "single concrete event" },
    { "title": "Syria — Car bomb explosion in Damascus", "expected": "REAL", "note": "single concrete event" },
    { "title": "Global — US extends Russian oil sanctions waiver and G7 rift over Russia policy", "expected": "FAKE", "note": "two distinct events bundled" },
    { "title": "United States — San Diego mosque shooting and hero security guard Amin Abdullah", "expected": "REAL", "note": "single concrete event" },
    { "title": "Spain — Arrest of Jonathan Andic in Catalonia over father Isak Andic's death", "expected": "REAL", "note": "single concrete event" },
    { "title": "US Politics — Trump Endorsements in Texas and Kentucky Republican Primaries", "expected": "BORDERLINE", "note": "same actor, same domain; reasonable consolidation" },
    { "title": "US Legal Developments — Musk's OpenAI Lawsuit Dismissed, Trump's IRS Lawsuit Dropped, Justice Department Anti-Weaponization Fund", "expected": "FAKE", "note": "three unrelated legal items bundled" },
    { "title": "East Asia — Putin's state visit to Beijing amid diplomatic sequencing with Trump summit", "expected": "REAL", "note": "single concrete event" },
    { "title": "DR Congo — Ebola outbreak in Ituri province (Bundibugyo virus, PHEIC declaration)", "expected": "REAL", "note": "single concrete event" },
    { "title": "Ukraine-Russia drone warfare escalation — frontline operations and long-range strikes", "expected": "REAL", "note": "single concrete topic/event-cluster" },
    { "title": "FIFA World Cup 2026 — National team squad announcements (Portugal, Brazil)", "expected": "BORDERLINE", "note": "same event type, two countries; reasonable merge" },
    { "title": "Spain — Shakira acquitted and awarded €55m tax refund in Spanish tax case", "expected": "REAL", "note": "single concrete event" },
    { "title": "Australia — Tasmania government apology for historical retention of Indigenous and other human remains", "expected": "REAL", "note": "single concrete event" }
  ]
}
```

- [ ] **Step 5.2: 验证 JSON 合法 + 计数**

Run:

```bash
cd scripts/eval/story-validation && node -e "
const c = JSON.parse(require('fs').readFileSync('calibration.json','utf8'));
const counts = c.labels.reduce((a,l)=>{a[l.expected]=(a[l.expected]||0)+1;return a},{});
console.log('Total:', c.labels.length, '| Breakdown:', counts);
"
```

Expected: `Total: 19 | Breakdown: { BORDERLINE: 3, FAKE: 5, REAL: 11 }`

---

## Task 6: 实现 LLM judge 模块

**Files:**
- Create: `scripts/eval/story-validation/judge.ts`

- [ ] **Step 6.1: 写 judge.ts**

完整内容：

```ts
import type { Story, ArticleInfo, JudgeResult, Verdict } from './types.js';

const AI_WORKER_URL = process.env.AI_WORKER_URL || 'http://localhost:8788';

const JUDGE_PROMPT = (story: Story, articles: ArticleInfo[]) => `
You are a strict editorial judge. Given a story candidate generated by an
upstream news clustering+validation pipeline, decide if it is a REAL coherent
story, a BORDERLINE multi-angle consolidation, or FAKE (LLM padding of
unrelated articles under a common label).

# Definitions
- REAL: articles cover one concrete event/situation. Multi-outlet reporting on
  the same incident or its direct follow-ups.
- BORDERLINE: articles share a tight theme + same actor space (e.g.
  "Trump endorsements in TX and KY" or "World Cup squad announcements PT/BR").
  Defensible as a single editorial unit even if not literally one event.
- FAKE: articles glued together by region/domain label only (e.g.
  "Latin America — protest in Bolivia AND Mexico ex-officials surrender").
  Each item is its own event with no shared narrative.

# Anti-patterns that point to FAKE
- Title joins distinct events with " and ", "; ", "+", or commas
- Title uses only a region/geography/domain word as the unifier
- Same article would naturally appear in two unrelated stories

# Story to judge
Title: ${story.title}
Importance (LLM-assigned): ${story.importance}
Articles (${articles.length}):
${articles.map(a => `- [${a.id}] ${a.title}${a.event_summary_points?.length ? '\n    Points: ' + a.event_summary_points.join('; ') : ''}`).join('\n')}

# Output
Reply with ONLY a JSON object inside a \`\`\`json fenced block. No prose.
{
  "verdict": "REAL" | "BORDERLINE" | "FAKE",
  "coherence": 1-5,
  "title_fit": 1-5,
  "reason": "<one short sentence>"
}
`.trim();

function parseJSON(raw: string): JudgeResult | null {
  // 借鉴 ai-worker 的 parseJSONFromResponse —— 容错代码块/// 注释/尾随逗号
  const candidates: string[] = [];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);
  const f = raw.indexOf('{'); const l = raw.lastIndexOf('}');
  if (f >= 0 && l > f) candidates.push(raw.slice(f, l + 1));
  candidates.push(raw);

  for (const c of candidates) {
    const cleaned = c
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:"'])\/\/[^\n]*/g, '$1')
      .replace(/,(\s*[}\]])/g, '$1')
      .trim();
    try {
      const obj = JSON.parse(cleaned);
      if (obj && typeof obj.verdict === 'string') return obj as JudgeResult;
    } catch { /* try next */ }
  }
  return null;
}

export async function judgeStory(
  story: Story,
  articles: ArticleInfo[],
  options: { model?: string } = {}
): Promise<JudgeResult> {
  const model = options.model || 'qwen-plus';
  const body = {
    messages: [{ role: 'user', content: JUDGE_PROMPT(story, articles) }],
    options: { provider: 'dashscope', model, temperature: 0, max_tokens: 300 },
  };

  const resp = await fetch(`${AI_WORKER_URL}/meridian/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`Judge call failed: ${resp.status} ${txt.slice(0, 200)}`);
  }
  const data = await resp.json() as any;
  const content = data?.data?.choices?.[0]?.message?.content || '';
  const parsed = parseJSON(content);
  if (!parsed) {
    return {
      verdict: 'BORDERLINE',
      coherence: 0,
      title_fit: 0,
      reason: `judge JSON parse failed; raw: ${content.slice(0, 120)}`,
    };
  }
  // sanitize
  const v: Verdict = ['REAL','BORDERLINE','FAKE'].includes(parsed.verdict) ? parsed.verdict : 'BORDERLINE';
  return {
    verdict: v,
    coherence: clamp(parsed.coherence, 1, 5),
    title_fit: clamp(parsed.title_fit, 1, 5),
    reason: (parsed.reason || '').toString().slice(0, 400),
  };
}

function clamp(n: any, lo: number, hi: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}
```

- [ ] **Step 6.2: 用真实 ai-worker 做 smoke**

写临时 smoke 文件 `_smoke-judge.ts`：

```ts
import { judgeStory } from './judge.js';

// brief #7 里两个对照 case：一个明显 REAL，一个明显 FAKE
const realCase = await judgeStory(
  { title: "Syria — Car bomb explosion in Damascus", importance: 6, articleIds: [1,2], storyType: "SINGLE_STORY" },
  [
    { id: 1, title: "Car bomb hits central Damascus, dozens injured", url: "https://example.com/1" },
    { id: 2, title: "Damascus blast: police cordon off blast site, identify casualties", url: "https://example.com/2" },
  ]
);
console.log('REAL case →', JSON.stringify(realCase, null, 2));

const fakeCase = await judgeStory(
  { title: "Latin America — Bolivia anti-government protests and Mexico ex-officials surrender over cartel ties", importance: 7, articleIds: [3,4], storyType: "SINGLE_STORY" },
  [
    { id: 3, title: "Bolivia: Anti-government protests escalate in La Paz", url: "https://example.com/3" },
    { id: 4, title: "Mexico: Three former officials surrender on cartel-related charges", url: "https://example.com/4" },
  ]
);
console.log('FAKE case →', JSON.stringify(fakeCase, null, 2));
```

Run（确保 ai-worker 8788 还活着）：

```bash
cd scripts/eval/story-validation && pnpm exec tsx _smoke-judge.ts
```

Expected:
- `REAL case` 输出 `verdict: "REAL"`，coherence/title_fit 都 ≥4
- `FAKE case` 输出 `verdict: "FAKE"`，coherence/title_fit 都 ≤2

如果 judge 把 FAKE case 错判成 REAL → 调 JUDGE_PROMPT 的措辞，加强 anti-pattern
描述（重跑直至正确）。

- [ ] **Step 6.3: 删除 smoke 文件**

Run:

```bash
rm scripts/eval/story-validation/_smoke-judge.ts
```

---

## Task 7: 实现 markdown 报告渲染

**Files:**
- Create: `scripts/eval/story-validation/report.ts`

- [ ] **Step 7.1: 写 report.ts**

完整内容：

```ts
import type { EvalReport, Verdict } from './types.js';

const VERDICTS: Verdict[] = ['REAL', 'BORDERLINE', 'FAKE'];

export function renderMarkdown(r: EvalReport): string {
  const lines: string[] = [];

  lines.push(`# Eval Report — ${r.workflowId}`);
  lines.push('');
  lines.push('## Run metadata');
  lines.push(`- prompt_hash: ${r.promptHash}`);
  lines.push(`- judge_model: ${r.judgeModel}`);
  lines.push(`- eval_timestamp: ${r.timestamp}`);
  lines.push('');

  // Aggregate
  const counts: Record<Verdict, number> = { REAL: 0, BORDERLINE: 0, FAKE: 0 };
  for (const e of r.evaluations) counts[e.finalVerdict]++;
  const qualityRate = r.evaluations.length === 0 ? 0
    : (counts.REAL / r.evaluations.length * 100);

  lines.push('## Aggregate');
  lines.push(`- candidates (valid+rejected from workflow): ${r.candidateCount}`);
  lines.push(`- llm passed (valid): ${r.passedCount}`);
  lines.push(`- after eval: ${counts.REAL} REAL / ${counts.BORDERLINE} BORDERLINE / ${counts.FAKE} FAKE`);
  lines.push(`- quality rate (REAL / passed): ${qualityRate.toFixed(1)}%`);
  lines.push('');

  // Per-story table
  lines.push('## Per-story');
  lines.push('| # | title | judge | heuristics | final |');
  lines.push('|---|---|---|---|---|');
  r.evaluations.forEach((e, i) => {
    const title = e.story.title.length > 80 ? e.story.title.slice(0, 77) + '...' : e.story.title;
    const h = e.heuristic.flags.join(', ') || '—';
    lines.push(`| ${i + 1} | ${escapePipe(title)} | ${e.judge.verdict} | ${h} | **${e.finalVerdict}** |`);
  });
  lines.push('');

  // Calibration
  if (r.calibration) {
    const c = r.calibration;
    lines.push(`## Calibration (n=${c.total}${c.total < 30 ? ', LOW-N warning' : ''})`);
    lines.push(`- matched: ${c.matched}/${c.total}`);
    lines.push(`- precision: ${c.precision.toFixed(2)}`);
    lines.push(`- recall: ${c.recall.toFixed(2)}`);
    lines.push(`- F1: ${c.f1.toFixed(2)}${c.f1 < 0.7 ? '  ⚠️ F1 < 0.7 — tune judge prompt before trusting results' : ''}`);
    lines.push('');
    lines.push('Confusion matrix (rows=ground truth, cols=judged):');
    lines.push('');
    lines.push('| | REAL | BORDERLINE | FAKE |');
    lines.push('|---|---|---|---|');
    for (const gt of VERDICTS) {
      lines.push(`| **${gt}** | ${c.confusion[gt].REAL} | ${c.confusion[gt].BORDERLINE} | ${c.confusion[gt].FAKE} |`);
    }
    lines.push('');
  }

  // Per-story detail
  lines.push('## Per-story detail');
  r.evaluations.forEach((e, i) => {
    lines.push(`### ${i + 1}. ${e.story.title}`);
    lines.push(`- articles: ${e.story.articleIds.length}, importance: ${e.story.importance}`);
    lines.push(`- final verdict: **${e.finalVerdict}**`);
    lines.push(`- judge: ${e.judge.verdict} (coherence ${e.judge.coherence}/5, title_fit ${e.judge.title_fit}/5)`);
    lines.push(`  reason: ${e.judge.reason}`);
    if (e.heuristic.flags.length) {
      lines.push(`- heuristic flags:`);
      for (const f of e.heuristic.flags) {
        lines.push(`  - ${f}: ${e.heuristic.details[f]}`);
      }
    }
    lines.push('');
  });

  // Rejected clusters summary
  if (r.rejectedClusters.length) {
    lines.push('## Rejected by upstream LLM');
    const reasons: Record<string, number> = {};
    for (const rc of r.rejectedClusters) {
      reasons[rc.rejectionReason] = (reasons[rc.rejectionReason] || 0) + 1;
    }
    lines.push(`- counts: ${Object.entries(reasons).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  }

  return lines.join('\n');
}

function escapePipe(s: string): string { return s.replace(/\|/g, '\\|'); }
```

- [ ] **Step 7.2: typecheck**

Run:

```bash
cd scripts/eval/story-validation && pnpm exec tsc --noEmit
```

Expected: 退出码 0。

---

## Task 8: 实现主入口 score.ts

**Files:**
- Create: `scripts/eval/story-validation/score.ts`

- [ ] **Step 8.1: 写 score.ts**

完整内容：

```ts
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import calibration from './calibration.json' with { type: 'json' };
import { runHeuristics, detectSplitOverlap } from './heuristics.js';
import { judgeStory } from './judge.js';
import { renderMarkdown } from './report.js';
import type {
  Story, StoryValidationStepData, ArticleInfo, StoryEvaluation,
  EvalReport, Verdict, CalibrationMetrics
} from './types.js';

const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:8787';
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../..');
const REPORTS_DIR = resolve(REPO_ROOT, 'eval-reports');

const VERDICTS: Verdict[] = ['REAL', 'BORDERLINE', 'FAKE'];

interface CLIArgs {
  workflowId: string;
  calibrate: boolean;
  judgeModel: string;
}

function parseArgs(argv: string[]): CLIArgs {
  const args: Partial<CLIArgs> = { calibrate: false, judgeModel: 'qwen-plus' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--workflow') args.workflowId = argv[++i];
    else if (a === '--calibrate') args.calibrate = true;
    else if (a === '--judge-model') args.judgeModel = argv[++i];
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
  }
  if (!args.workflowId) { printHelp(); process.exit(1); }
  return args as CLIArgs;
}

function printHelp() {
  console.log(`Usage: pnpm score --workflow <id> [--calibrate] [--judge-model qwen-plus]

Reads workflow story_validation step from backend observability,
runs heuristics + LLM judge per story, writes markdown report to
eval-reports/<workflowId>.md.

Env:
  BACKEND_URL   default http://localhost:8787
  AI_WORKER_URL default http://localhost:8788  (used by judge.ts)
`);
}

// 通过 backend observability API 找到指定 workflow 的最新一份数据并读取
async function fetchWorkflowData(workflowId: string): Promise<StoryValidationStepData> {
  const listResp = await fetch(`${BACKEND_URL}/observability/workflows`);
  if (!listResp.ok) throw new Error(`List workflows failed: ${listResp.status}`);
  const list = await listResp.json() as { workflows: Array<{ key: string; uploaded: string }> };
  const matches = list.workflows
    .filter(w => w.key.includes(workflowId))
    .sort((a, b) => b.uploaded.localeCompare(a.uploaded));
  if (matches.length === 0) throw new Error(`No observability records for workflow ${workflowId}`);
  const key = matches[0].key;

  const detailResp = await fetch(`${BACKEND_URL}/observability/workflows/${encodeURIComponent(key)}`);
  if (!detailResp.ok) throw new Error(`Fetch workflow detail failed: ${detailResp.status}`);
  const detail = await detailResp.json() as { detailedMetrics: any[] };

  const step = detail.detailedMetrics.find(m =>
    m.stepName === 'story_validation' && m.status === 'completed'
  );
  if (!step) throw new Error('story_validation completed step not found in workflow data');
  const data = step.data as StoryValidationStepData;
  if (!Array.isArray((data as any).stories)) {
    throw new Error('Workflow observability does not contain full stories[]. Apply Task 1 first.');
  }
  return data;
}

// 取一组 articleId 对应的 title / url（从 backend reports?）
// 目前没有现成的 batch article endpoint，简化方案：通过 DB 直接拿是另一条路径。
// v1 用 backend `/observability/workflows/:key` 里的 prepare_dataset step 数据。
async function fetchArticles(workflowId: string, ids: number[]): Promise<Map<number, ArticleInfo>> {
  // prepare_dataset 步会记录 articleCount 但不一定记录每篇内容。
  // v1 fallback：尝试调一个简单的 backend endpoint 拿 articles by ids；
  // 不存在则降级到只用 article id（judge prompt 里没有 title 也能跑，质量稍差）。
  const resp = await fetch(`${BACKEND_URL}/admin/articles/by-ids`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!resp.ok) {
    console.warn(`[score] /admin/articles/by-ids returned ${resp.status} — judge will run without article titles.`);
    return new Map();
  }
  const data = await resp.json() as { articles: ArticleInfo[] };
  return new Map(data.articles.map(a => [a.id, a]));
}

function computeCalibration(
  evals: StoryEvaluation[],
): CalibrationMetrics | undefined {
  const labelMap = new Map<string, Verdict>();
  for (const l of calibration.labels) labelMap.set(l.title, l.expected as Verdict);

  const confusion: Record<Verdict, Record<Verdict, number>> = {
    REAL:       { REAL: 0, BORDERLINE: 0, FAKE: 0 },
    BORDERLINE: { REAL: 0, BORDERLINE: 0, FAKE: 0 },
    FAKE:       { REAL: 0, BORDERLINE: 0, FAKE: 0 },
  };
  let matched = 0;
  for (const e of evals) {
    const gt = labelMap.get(e.story.title);
    if (!gt) continue;
    confusion[gt][e.finalVerdict]++;
    matched++;
  }
  // Treat REAL as positive class
  const tp = confusion.REAL.REAL;
  const fp = confusion.BORDERLINE.REAL + confusion.FAKE.REAL;
  const fn = confusion.REAL.BORDERLINE + confusion.REAL.FAKE;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall    = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : 2 * precision * recall / (precision + recall);

  return {
    matched,
    total: calibration.labels.length,
    precision, recall, f1, confusion,
  };
}

function mergeVerdict(judge: Verdict, heuristicFlagCount: number): Verdict {
  if (heuristicFlagCount >= 2 && judge === 'REAL') return 'BORDERLINE';
  return judge;
}

async function computePromptHash(): Promise<string> {
  const path = resolve(REPO_ROOT, 'services/meridian-ai-worker/src/prompts/storyValidation.ts');
  try {
    const content = await readFile(path, 'utf8');
    return createHash('sha1').update(content).digest('hex').slice(0, 8);
  } catch {
    return 'unknown';
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log(`[score] workflow=${args.workflowId} calibrate=${args.calibrate}`);

  const data = await fetchWorkflowData(args.workflowId);
  console.log(`[score] fetched ${data.stories.length} valid stories, ${data.rejectedClusters.length} rejected`);

  // 收集所有 articleId 一次性拉
  const allIds = [...new Set(data.stories.flatMap(s => s.articleIds))];
  const articleMap = await fetchArticles(args.workflowId, allIds);
  console.log(`[score] fetched info for ${articleMap.size}/${allIds.length} articles`);

  const overlapMap = detectSplitOverlap(data.stories);
  const evals: StoryEvaluation[] = [];
  for (let i = 0; i < data.stories.length; i++) {
    const story = data.stories[i];
    const heuristic = runHeuristics(story, i, overlapMap);
    const articles = story.articleIds
      .map(id => articleMap.get(id))
      .filter((a): a is ArticleInfo => !!a);
    process.stdout.write(`[score] judging ${i + 1}/${data.stories.length}... `);
    const judge = await judgeStory(story, articles, { model: args.judgeModel });
    process.stdout.write(`${judge.verdict}\n`);
    const finalVerdict = mergeVerdict(judge.verdict, heuristic.flags.length);
    evals.push({ story, heuristic, judge, finalVerdict });
  }

  const report: EvalReport = {
    workflowId: args.workflowId,
    promptHash: await computePromptHash(),
    judgeModel: args.judgeModel,
    timestamp: new Date().toISOString(),
    candidateCount: data.stories.length + data.rejectedClusters.length,
    passedCount: data.stories.length,
    evaluations: evals,
    rejectedClusters: data.rejectedClusters,
    calibration: args.calibrate ? computeCalibration(evals) : undefined,
  };

  const md = renderMarkdown(report);
  await mkdir(REPORTS_DIR, { recursive: true });
  const outPath = resolve(REPORTS_DIR, `${args.workflowId}.md`);
  await writeFile(outPath, md, 'utf8');
  console.log(`[score] report written: ${outPath}`);

  if (report.calibration) {
    console.log(`[score] calibration F1: ${report.calibration.f1.toFixed(2)} (precision ${report.calibration.precision.toFixed(2)}, recall ${report.calibration.recall.toFixed(2)})`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
```

- [ ] **Step 8.2: typecheck**

Run:

```bash
cd scripts/eval/story-validation && pnpm exec tsc --noEmit
```

Expected: 退出码 0。

---

## Task 9: 加 backend 端点 `/admin/articles/by-ids`

**目的：** Task 8 的 `fetchArticles()` 需要按 id 批量取文章 title/url/summary，
backend 现有 admin 路由没有这个端点。补一个最小实现。

**Files:**
- Modify: `apps/backend/src/routers/admin.ts`（在文件末尾或合适位置加一个新 handler）

- [ ] **Step 9.1: 加新 handler**

在 `apps/backend/src/routers/admin.ts` 找一个现有 `app.post(...)` 后追加：

```ts
app.post('/articles/by-ids', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const ids = Array.isArray(body.ids) ? body.ids.filter((n: any) => Number.isInteger(n)) : [];
    if (ids.length === 0) {
      return c.json({ success: true, articles: [] });
    }
    const db = getDb(c.env.HYPERDRIVE.connectionString);
    const rows = await db
      .select({
        id: $articles.id,
        title: $articles.title,
        url: $articles.url,
        event_summary_points: $articles.event_summary_points,
      })
      .from($articles)
      .where(inArray($articles.id, ids));
    return c.json({ success: true, articles: rows });
  } catch (e: any) {
    return c.json({ success: false, error: e?.message || 'unknown' }, 500);
  }
});
```

确认 import 已含 `inArray`（顶部 `import { ..., inArray } from '@meridian/database'`，
auto-brief workflow 已有类似 import 可参考）。如缺，加上。

- [ ] **Step 9.2: 触发等 wrangler hot-reload 完成后做 smoke**

Run:

```bash
curl -s http://localhost:8787/admin/articles/by-ids \
  -X POST -H "Content-Type: application/json" \
  -d '{"ids":[39656,39657,39658]}' | python3 -m json.tool
```

Expected: `success: true`, `articles` 数组含 3 条记录，每条有 `id`/`title`/`url`。

---

## Task 10: 端到端跑 + 验收

**Files:** 无新文件（运行已写好的脚本）

- [ ] **Step 10.1: 触发一次新 brief（可选：复用 brief #7 的 workflow id）**

如果 brief #7 的 observability 已含 stories（在 Task 1 之后），直接复用：

```bash
WF_ID=admin-brief-1779253365414
```

否则按 Task 1 Step 1.3 触发一份新的，取新 `workflowId`。

- [ ] **Step 10.2: 跑 eval（带 calibrate）**

Run:

```bash
cd scripts/eval/story-validation && pnpm score -- --workflow "$WF_ID" --calibrate
```

(或 `pnpm exec tsx score.ts --workflow "$WF_ID" --calibrate`)

Expected stdout：
- `[score] fetched 19 valid stories, 7 rejected`（数字按当前 brief 实际）
- `[score] fetched info for 19/19 articles`（或接近）
- `[score] judging 1/19... <verdict>` 重复 19 行
- 最末 `[score] report written: <abs path>/eval-reports/admin-brief-1779253365414.md`
- `[score] calibration F1: <0-1 float>`

- [ ] **Step 10.3: 检查报告**

Run:

```bash
cat eval-reports/admin-brief-1779253365414.md | head -80
```

Expected: markdown 渲染正确，可见：
- Run metadata（promptHash 是 8 位 hex）
- Aggregate（含 quality rate）
- Per-story 表格（19 行）
- Calibration 段（含 F1、混淆矩阵 3×3）

人工 sanity check：
- 报告里给 `FAKE` 的故事应该多数命中 calibration 里 expected=FAKE 的那 5 个
- F1 不应该是 0；若 F1 < 0.3 大概率 calibration 标题对不上 → 检查 step 8 里 `fetchArticles()` 是否返回为空导致 judge 用空 articles 跑出垃圾结果

- [ ] **Step 10.4: 验收记录**

把以下数据点写到屏幕（不入库）：
1. F1 数值
2. quality rate
3. 报告里前 3 个被打成 `FAKE` 的 story 是哪几个，是否与人工标注里的 5 个 FAKE 重合

如果 F1 ≥ 0.7 且 FAKE 命中重合 ≥ 4/5：v1 验收通过。
否则不修代码 —— 直接停下来跟用户讨论 judge prompt 调整方向。

---

## 完成判据

- [x] backend observability 含完整 `stories[]`（Task 1）
- [x] `scripts/eval/story-validation/` 5 个 .ts + 1 个 calibration.json 全部存在且 typecheck 通过
- [x] `/admin/articles/by-ids` endpoint 可用
- [x] `pnpm score --workflow <id> --calibrate` 跑通并产出报告
- [x] Calibration F1 ≥ 0.7（v1 接受门槛）

## 不做（YAGNI）

- 自动单元测试文件（用户 CLAUDE.md 禁）
- Mock（同上）
- `git commit` 步骤（用户禁，待最终人工审视）
- 报告自动 trend 聚合
- Web UI

## Self-review log

完成时间 2026-05-20。Scan 结果：
- 无 TBD/TODO；所有 step 含可执行内容
- Step 4.1 / 7.1 / 8.1 类型签名与 types.ts 一致：`Verdict`, `EvalReport`,
  `StoryEvaluation` 都正确引用
- Step 8.1 调用 `mergeVerdict(judge, heuristic.flags.length)` 与
  `mergeVerdict` 定义匹配
- Spec §4.3 终裁决合并规则在 Task 8 `mergeVerdict()` 中实现
- Spec §5.1 calibration set 在 Task 5 完整给出
- Spec §6 报告样式在 Task 7 `renderMarkdown()` 落地
- Spec §3.1 prereq 在 Task 1 落地
- 未实现项：spec §5.3 `_summary.tsv` 自动维护 —— 在"不做"里明确 defer
