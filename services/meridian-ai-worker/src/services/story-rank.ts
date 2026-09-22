/**
 * 故事重要性排序服务：三轮洗牌 + Borda 聚合。
 *
 * 判据与形态的取舍写在 prompts/story-rank.ts 顶部，这里只讲聚合层。
 *
 * ## 为什么必须三轮而不是一轮
 *
 * 单轮输出会自相矛盾（实测一轮里同一条既排第 1 又出现在落选名单，落选理由还引用它自己的
 * 报道量），也会偶发违反禁止清单（实测一轮把一场国葬选进前 12）。Borda 聚合把只在单轮
 * 出现的条目挤掉，这两类问题都被它兜住了。洗牌是为了治位置偏置——模型对输入顺序敏感，
 * 不洗牌的话三轮等于一轮跑三次。
 *
 * ## 代码侧只查机械可判定的项
 *
 * 能查：条数、id 重复、id 越界、eventKey 重复。违反则该轮重试一次。
 * **查不了**：禁止类型漏网。代码没法判断一条标题是不是体育赛果——离线评估时是人工
 * 硬编码了 clusterId 列表，生产没有这个。这一类只能靠 Borda 聚合兜底（实测有效，但那是
 * 两期的读数，不是保证）。若将来要设硬门，得先有一个独立的分类信号，不能拿模型自报的
 * category 当判据。
 *
 * ## 失败策略
 *
 * 三轮全失败才算整步失败，向上抛。部分轮次失败则用剩下的轮次聚合，并在返回值里报出来
 * ——调用方据此决定信不信这次排序。**不静默降级成机械序**：那会让「排序没生效」和
 * 「排序生效了但结果一样」变得不可分辨。
 */

import { getStoryRankPrompt, RANK_DATA_BLOCK_MARK, RANK_TOP_N, type RankCandidate } from '../prompts/story-rank'

export interface RankedPick {
  id: number
  eventKey: string
  category: string
  why: string
  /** Borda 总分；三轮都进前 1 名是 3*RANK_TOP_N */
  borda: number
  /** 在几轮里被选中（1-3）。1 的条目是边缘项，调用方可据此决定要不要信 */
  timesSelected: number
}

export interface RankRoundDiag {
  round: number
  ok: boolean
  error?: string
  selectedIds: number[]
  duplicates: number
  outOfRange: number
  eventKeyDupes: number
  retried: boolean
}

export interface StoryRankResult {
  /** Borda 降序的前 N 条 */
  picks: RankedPick[]
  /** 落选名单（合并三轮，按出现次数降序）——唯一能看见模型判据的窗口，只进观测 */
  nearMisses: Array<{ id: number; why: string; times: number }>
  rounds: RankRoundDiag[]
  roundsOk: number
  /** 三轮前 N 的交集大小。小说明排序在飘，调用方只进观测 */
  intersectionSize: number
}

const ROUNDS = 3

/** mulberry32——与离线迭代同一个 PRNG，换实现会换洗牌序，读数就不可比了。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 可复现的洗牌：同一 seed 同一输入得同一顺序，便于用日志复现某期的排序。 */
function shuffled<T>(items: T[], seed: number): T[] {
  const rand = mulberry32(seed)
  const a = items.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

type RawPick = { id?: unknown; eventKey?: unknown; category?: unknown; why?: unknown }
type RawResponse = { selected?: unknown; nearMisses?: unknown }

function coercePicks(parsed: RawResponse | null, valid: Set<number>) {
  const raw = Array.isArray(parsed?.selected) ? (parsed!.selected as RawPick[]) : []
  const picks: Array<{ id: number; eventKey: string; category: string; why: string }> = []
  const seenId = new Set<number>()
  const seenKey = new Set<string>()
  let duplicates = 0
  let outOfRange = 0
  let eventKeyDupes = 0
  for (const p of raw) {
    const id = typeof p?.id === 'number' ? p.id : Number(p?.id)
    if (!Number.isInteger(id) || !valid.has(id)) {
      outOfRange++
      continue
    }
    if (seenId.has(id)) {
      duplicates++
      continue
    }
    const eventKey = String(p?.eventKey ?? '').trim()
    if (eventKey && seenKey.has(eventKey)) {
      eventKeyDupes++
      continue
    }
    seenId.add(id)
    if (eventKey) seenKey.add(eventKey)
    picks.push({
      id,
      eventKey,
      category: String(p?.category ?? '').trim(),
      why: String(p?.why ?? '').trim(),
    })
  }
  const misses: Array<{ id: number; why: string }> = []
  const rawMiss = Array.isArray(parsed?.nearMisses) ? (parsed!.nearMisses as RawPick[]) : []
  for (const m of rawMiss) {
    const id = typeof m?.id === 'number' ? m.id : Number(m?.id)
    if (Number.isInteger(id) && valid.has(id)) misses.push({ id, why: String(m?.why ?? '').trim() })
  }
  return { picks, misses, duplicates, outOfRange, eventKeyDupes }
}

/**
 * @param callOnce 发一次 LLM 调用并返回正文。注入进来是为了让本文件不依赖 AI Gateway，
 *   端点侧决定用哪个 task/模型；也让这段聚合逻辑能单独跑。
 * @param parseJson 从模型正文里抽 JSON（可能带 ```json 围栏）。同样由调用方注入。
 */
export async function rankStories(
  candidates: RankCandidate[],
  callOnce: (prompt: string) => Promise<string>,
  parseJson: (text: string) => unknown
): Promise<StoryRankResult> {
  const valid = new Set(candidates.map(c => c.id))
  const rounds: RankRoundDiag[] = []
  const perRound: Array<Array<{ id: number; eventKey: string; category: string; why: string }>> = []
  const missTally = new Map<number, { why: string; times: number }>()

  for (let r = 1; r <= ROUNDS; r++) {
    let retried = false
    let diag: RankRoundDiag = {
      round: r,
      ok: false,
      selectedIds: [],
      duplicates: 0,
      outOfRange: 0,
      eventKeyDupes: 0,
      retried: false,
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const prompt = getStoryRankPrompt(shuffled(candidates, r))
        const content = await callOnce(prompt)
        const parsed = parseJson(content) as RawResponse | null
        const { picks, misses, duplicates, outOfRange, eventKeyDupes } = coercePicks(parsed, valid)
        diag = {
          round: r,
          ok: picks.length === RANK_TOP_N,
          selectedIds: picks.map(p => p.id),
          duplicates,
          outOfRange,
          eventKeyDupes,
          retried,
        }
        if (diag.ok) {
          perRound.push(picks)
          for (const m of misses) {
            const prev = missTally.get(m.id)
            missTally.set(m.id, { why: prev?.why || m.why, times: (prev?.times ?? 0) + 1 })
          }
          break
        }
        diag.error = `选出 ${picks.length} 条，期望 ${RANK_TOP_N}（重复 ${duplicates}／越界 ${outOfRange}／eventKey 重复 ${eventKeyDupes}）`
      } catch (e) {
        diag.error = e instanceof Error ? e.message : String(e)
      }
      retried = true
      diag.retried = true
    }
    rounds.push(diag)
  }

  // Borda：每轮第 1 名 RANK_TOP_N 分，递减到第 N 名 1 分，未入选 0 分。
  const borda = new Map<number, number>()
  const times = new Map<number, number>()
  const meta = new Map<number, { eventKey: string; category: string; why: string; best: number }>()
  for (const picks of perRound) {
    picks.forEach((p, i) => {
      const pts = RANK_TOP_N - i
      borda.set(p.id, (borda.get(p.id) ?? 0) + pts)
      times.set(p.id, (times.get(p.id) ?? 0) + 1)
      const prev = meta.get(p.id)
      // 理由取它排得最高那轮的——那轮最能代表模型为什么把它放上去
      if (!prev || pts > prev.best) meta.set(p.id, { eventKey: p.eventKey, category: p.category, why: p.why, best: pts })
    })
  }
  const picks: RankedPick[] = [...borda.entries()]
    .map(([id, score]) => {
      const m = meta.get(id)
      return {
        id,
        eventKey: m?.eventKey ?? '',
        category: m?.category ?? '',
        why: m?.why ?? '',
        borda: score,
        timesSelected: times.get(id) ?? 0,
      }
    })
    .sort((a, b) => b.borda - a.borda || a.id - b.id)
    .slice(0, RANK_TOP_N)

  const sets = perRound.map(p => new Set(p.map(x => x.id)))
  const intersectionSize = sets.length
    ? [...sets[0]].filter(id => sets.every(s => s.has(id))).length
    : 0

  return {
    picks,
    nearMisses: [...missTally.entries()]
      .map(([id, v]) => ({ id, why: v.why, times: v.times }))
      .sort((a, b) => b.times - a.times || a.id - b.id),
    rounds,
    roundsOk: perRound.length,
    intersectionSize,
  }
}
