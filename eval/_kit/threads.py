"""事件追踪线索归并的评测与基线（金标见 eval/_data/story-threads-v1、story-threads-exam-v1）。

评测口径（2026-09-29 定，读数见 docs/adr/0008-story-thread-grouping-threshold.md）：
- B³ 精确率 / 召回率 / F1：逐个故事比「系统给它的组」与「金标给它的组」的重合，再平均。
  精确低 = 串线，召回低 = 碎片化。组按全部已处理的期算，所以后期故事挂到前期线索上也会计入。
- 读者可见层面：只看跨 ≥2 期的线索——金标线被拆成几条、串进来几条。
- 金标 unsure 的故事整条排除。
- 判赢：`bootstrap_delta` 按期有放回重采样，差值 95% 区间下界 > 0 且差值超过噪声底（区间半宽）两倍，
  并且要在 ≥2 份独立数据上都成立（见 .claude/rules/prototypes.md「比较多个方案时」）。
"""
import collections, math, random

# 评测窗口（按期），对应 labels.jsonl 的 window 字段。整份数据集的 split 见各自 manifest。
SPLITS = {'dev': (1, 19), 'holdout': (20, 38), 'exam': (1, 10 ** 6), 'all': (1, 10 ** 6)}


def _per_story(pred, gold, hi):
    """每个故事的 (精确, 召回)；只用第 1..hi 期、非 unsure 的故事。"""
    U = [s for s, g in gold.items() if not g['unsure'] and g['period'] <= hi]
    missing = [s for s in U if s not in pred and str(s) not in pred]
    if missing:
        raise ValueError(f'预测缺 {len(missing)} 个故事，例如 {missing[:5]}')
    p = {s: str(pred.get(s, pred.get(str(s)))) for s in U}
    pc, gc = collections.defaultdict(set), collections.defaultdict(set)
    for s in U:
        pc[p[s]].add(s)
        gc[gold[s]['line']].add(s)
    out = {}
    for s in U:
        i = len(pc[p[s]] & gc[gold[s]['line']])
        out[s] = (i / len(pc[p[s]]), i / len(gc[gold[s]['line']]))
    return out, p, pc, gc


def score(pred, gold, split='all'):
    """pred: {story_id: 线索 key}；gold: data.load_gold(...) 的返回。"""
    lo, hi = SPLITS[split]
    ps, p, pc, gc = _per_story(pred, gold, hi)
    T = [s for s in ps if gold[s]['period'] >= lo]
    prec = sum(ps[s][0] for s in T) / len(T)
    rec = sum(ps[s][1] for s in T) / len(T)
    period = {s: gold[s]['period'] for s in ps}
    vis = lambda groups: {k: v for k, v in groups.items() if len({period[s] for s in v}) >= 2 and v & set(T)}
    pv, gv = vis(pc), vis(gc)
    split_lines = {k: len({p[s] for s in v if p[s] in pv}) for k, v in gv.items()}
    foreign = 0
    for v in pv.values():
        maj = collections.Counter(gold[s]['line'] for s in v).most_common(1)[0][0]
        foreign += sum(1 for s in v if gold[s]['line'] != maj)
    return {'split': split, 'n': len(T), 'precision': round(prec, 3), 'recall': round(rec, 3),
            'f1': round(2 * prec * rec / (prec + rec), 3), 'visible_threads': len(pv), 'gold_visible_lines': len(gv),
            'lines_split': sum(1 for n in split_lines.values() if n > 1), 'foreign_stories': foreign}


def bootstrap_delta(pred_a, pred_b, gold, split='all', n=200, seed=0):
    """B 相对 A 的 F1 差值：按期有放回重采样 n 次，返回 {delta, ci95, noise_floor}。noise_floor = 区间半宽。"""
    lo, hi = SPLITS[split]
    pa, *_ = _per_story(pred_a, gold, hi)
    pb, *_ = _per_story(pred_b, gold, hi)
    by_period = collections.defaultdict(list)
    for s in pa:
        if gold[s]['period'] >= lo:
            by_period[gold[s]['period']].append(s)
    periods = sorted(by_period)

    def f1(ps, stories):
        pr = sum(ps[s][0] for s in stories) / len(stories)
        rc = sum(ps[s][1] for s in stories) / len(stories)
        return 2 * pr * rc / (pr + rc)

    full = [s for p in periods for s in by_period[p]]
    delta = f1(pb, full) - f1(pa, full)
    rng = random.Random(seed)
    ds = []
    for _ in range(n):
        st = [s for p in rng.choices(periods, k=len(periods)) for s in by_period[p]]
        ds.append(f1(pb, st) - f1(pa, st))
    ds.sort()
    ci = (ds[int(0.025 * n)], ds[int(0.975 * n) - 1])
    return {'delta': round(delta, 4), 'ci95': [round(ci[0], 4), round(ci[1], 4)],
            'noise_floor': round((ci[1] - ci[0]) / 2, 4)}


def _unit(v):
    n = math.sqrt(sum(x * x for x in v))
    return [x / n for x in v]


def centroid_baseline(stories, vectors, tau=0.94, lookback=14):
    """生产算法复刻（apps/backend/src/lib/story-clusters.ts）：每期按 story_id 顺序，
    与最近 lookback 期活跃线索的质心（成员向量均值）比，最像的 ≥tau 并入，否则新开。

    stories: [{story_id, period}]；vectors: {story_id: 向量}。返回 {story_id: 线索 key}。
    2026-09-29 与生产在 888 个故事上逐条一致（门槛 0.94）。
    """
    threads, assign = [], {}
    for s in sorted(stories, key=lambda x: (x['period'], x['story_id'])):
        v = _unit(vectors[s['story_id']])
        live = [t for t in threads if t['last'] > s['period'] - lookback]
        best, sim = None, -1
        for t in live:
            c = sum(a * b for a, b in zip(t['c'], v))
            if c > sim:
                best, sim = t, c
        if best and sim >= tau:
            best['m'].append(v)
            best['c'] = _unit([sum(x) / len(best['m']) for x in zip(*best['m'])])
            best['last'] = s['period']
            assign[s['story_id']] = best['id']
        else:
            t = {'id': f't{len(threads)}', 'm': [v], 'c': v, 'last': s['period']}
            threads.append(t)
            assign[s['story_id']] = t['id']
    return assign


# ---------- 判官：两个故事该不该放进同一条线索 ----------

# 用户定的分组规则（2026-09-29），与 eval/_data/story-threads-v1/rubric.md 一致。
GRANULARITY_RULES = """事件追踪的分组规则：
1. 粒度跟着读者会追的大局走：整场俄乌战争是一条，不按单次袭击拆开。
2. 同一方干的同一类事算一条：朝鲜服役新驱逐舰和试射导弹是一条；俄罗斯在欧洲的无人机袭击、军火库、破坏、暗杀阴谋是一条。
3. 一件大事引出的后果并进这件大事：加拿大因贸易战靠拢欧盟并进美加贸易战；伊朗战争带来的美国油价、通胀并进美伊战争；加沙战争引起的国际诉讼、通缉令并进加沙战争。
4. 一个政策领域可以单独成一条（特朗普收紧移民：签证、H-1B、出生公民权、ICE 执法是一条），但不能把一个政府的所有政策或事件并成一个主题。
5. 话题相同不等于同一条：两起不相干的枪击案、两场不同的峰会（上合与金砖）各是各的。"""

SAME_LINE_SCHEMA = {'type': 'object', 'properties': {'same_line': {'type': 'boolean'}, 'reason': {'type': 'string'}},
                    'required': ['same_line', 'reason'], 'additionalProperties': False}


def _fmt_story(label, s):
    lines = [f'故事{label}：', f"日期：{s['published_at'][:10]}", f"标题：{s['title']}", '要点：']
    lines += [f'- {p}' for p in s['event_summary_points'][:5]]
    lines.append('实体：' + '、'.join(s['key_entities'][:6]))
    return '\n'.join(lines)


def same_line_prompt(story_a, story_b):
    """判「两故事该不该同线」的 prompt。与 2026-09-29 codex / glm 探测逐字相同，读数可直接比
    （eval/_data/story-thread-pairs-v1/rubric.md）。story_* 是 data.load_evidence 的行。"""
    return (GRANULARITY_RULES + '\n\n' + _fmt_story('甲', story_a) + '\n\n' + _fmt_story('乙', story_b) + '\n\n'
            + '这两个故事在事件追踪里应不应该放进同一条线索？只输出 JSON：'
            + '{"same_line": true/false, "reason": "<一句话>"}')
