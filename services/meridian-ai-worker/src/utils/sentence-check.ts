/**
 * 【逐句核查 · 纯函数】整簇索引与三个检索工具（search / timeline / read），不碰网络、不碰 env。
 *
 * 逐字搬自原型 `apps/backend/prototypes/writer-faithfulness/agent-kit.mts`（本地，不入库；冻结副本在
 * `.scratch/writer-checker-loop/port-source/`）：`when`、`Lookup`（search / timeline / read / citable）。
 * 给 agent 看的观察文本与打分规则一个字都别改（ADR 0010 的读数是在它上面测的）。
 *
 * 与原型的形状差异（不改语义）：
 *   · 整簇来自请求本身（`clusterOf`）：每篇文章的每一句，用窗口步同一份切句、1 起编号，带文章的 publishDate；
 *     原型读录下来的 trace 文件。句子按 articleId 升序排（原型的 articleSentences 是以 id 为键的对象，
 *     遍历序就是 id 升序），search 同分时的先后因此一致。
 *   · 简报日期取请求里最新一篇的 UTC 日期（`briefDateOf`）；原型按期号推算。
 */
import { numbersIn, type V6Article } from './brief-block-v6';

export interface ClusterSentence {
  articleId: number;
  n: number;
  text: string;
  published: string;
}

export interface CheckCluster {
  sents: ClusterSentence[];
  byKey: Map<string, ClusterSentence>;
  byArticle: Map<number, ClusterSentence[]>;
  articles: { id: number; title: string; published: string }[];
  idf: Map<string, number>;
}

/**
 * 一次核查的结论。`ok: false` 的字段是核查 agent 的原话（可能缺）；evidence 只含它看过的句子。
 */
export type Verdict =
  | { ok: true }
  | { ok: false; type?: string; problem?: string; evidence: [number, number][]; fix?: string };

export const when = (iso: string) => (iso ? iso.replace('T', ' ').slice(0, 16) + ' UTC' : 'time unknown');
const words = (t: string) => (t.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []).filter(w => w.length > 1);

/** 整簇：请求里全部文章的全部句子（编号与窗口步相同），每句带它那篇的发布时间。 */
export function clusterOf(articles: V6Article[]): CheckCluster {
  const list = [...articles].sort((a, b) => a.id - b.id);
  const sents: ClusterSentence[] = list.flatMap(a =>
    a.sentences.map((text, i) => ({ articleId: a.id, n: i + 1, text, published: a.publishDate }))
  );
  const byKey = new Map(sents.map(s => [`${s.articleId}:${s.n}`, s]));
  const byArticle = new Map<number, ClusterSentence[]>();
  for (const s of sents) (byArticle.get(s.articleId) ?? byArticle.set(s.articleId, []).get(s.articleId)!).push(s);
  for (const l of byArticle.values()) l.sort((a, b) => a.n - b.n);
  const df = new Map<string, number>();
  for (const s of sents) for (const w of new Set(words(s.text))) df.set(w, (df.get(w) ?? 0) + 1);
  const idf = new Map([...df].map(([w, d]) => [w, Math.log(1 + sents.length / d)]));
  return { sents, byKey, byArticle, articles: list.map(a => ({ id: a.id, title: a.title, published: a.publishDate })), idf };
}

/**
 * 简报日期：请求里最新一篇文章 publishDate 的 UTC 日期（YYYY-MM-DD）。没有一篇带得出日期 → null。
 * 只从请求推：接口不变，重放也是确定的。
 */
export function briefDateOf(articles: Array<{ publishDate: string }>): string | null {
  const t = Math.max(...articles.map(a => Date.parse(a.publishDate)).filter(Number.isFinite));
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : null;
}

/** 在一个簇上做 search / timeline / read；记住给 agent 看过的每一句（结论只许引这些）。 */
export class Lookup {
  seen = new Set<string>();
  constructor(protected c: CheckCluster) {}

  line(s: ClusterSentence) {
    this.seen.add(`${s.articleId}:${s.n}`);
    return `[${s.articleId}:${s.n}] (published ${when(s.published)}) ${s.text}`;
  }

  /** 一开始就给 agent 看的句子记作看过。 */
  show(keys: Iterable<string>) {
    for (const k of keys) this.seen.add(k);
  }

  search(args: any): string {
    const q = [...new Set(words(String(args?.query ?? '')))];
    if (!q.length) return 'search needs args.query (some words).';
    const scored = this.c.sents
      .map(s => {
        const w = new Set(words(s.text));
        return { s, score: q.reduce((acc, t) => acc + (w.has(t) ? this.c.idf.get(t) ?? 0 : 0), 0) };
      })
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
    return scored.length ? scored.map(x => this.line(x.s)).join('\n') : 'No sentence matches those words.';
  }

  timeline(args: any): string {
    const term = String(args?.term ?? '').trim();
    if (!term) return 'timeline needs args.term (a name, a word or a number).';
    const isNum = /^\d[\d,.]*$/.test(term);
    const key = term.toLowerCase().replace(/,/g, '');
    const hits = this.c.sents
      .filter(s => (isNum ? numbersIn(s.text).has(key) : s.text.toLowerCase().includes(key)))
      .sort((a, b) => a.published.localeCompare(b.published) || a.articleId - b.articleId || a.n - b.n);
    if (!hits.length) return `No sentence contains "${term}".`;
    const shown = hits.slice(0, 15).map(s => this.line(s));
    return `${hits.length} sentence(s) contain "${term}", oldest report first:\n${shown.join('\n')}${hits.length > 15 ? `\n(${hits.length - 15} more not shown; use a narrower term)` : ''}`;
  }

  read(args: any): string {
    const a = Number(args?.articleId);
    const n = Number(args?.sentence);
    const list = this.c.byArticle.get(a);
    if (!list) return `No article ${a} in this cluster.`;
    const art = this.c.articles.find(x => x.id === a);
    const around = list.filter(s => Math.abs(s.n - n) <= 2);
    if (!around.length) return `Article ${a} has no sentence ${n}.`;
    return `Article ${a} "${art?.title ?? ''}", published ${when(art?.published ?? '')}:\n${around.map(s => (s.n === n ? '> ' : '  ') + this.line(s)).join('\n')}`;
  }

  /** [[a, n], …] 或 [{articleId, sentence}, …] → key，外加其中不能引的原因。 */
  citable(raw: unknown): { keys: string[]; errors: string[] } {
    const list = Array.isArray(raw) ? raw : [];
    const keys: string[] = [];
    const errors: string[] = [];
    for (const r of list) {
      const k = `${Number(Array.isArray(r) ? r[0] : (r as any)?.articleId)}:${Number(Array.isArray(r) ? r[1] : (r as any)?.sentence)}`;
      if (!this.c.byKey.has(k)) errors.push(`[${k}] does not exist in this cluster`);
      else if (!this.seen.has(k)) errors.push(`[${k}] has not been shown to you yet; look at it first`);
      else if (!keys.includes(k)) keys.push(k);
    }
    return { keys, errors };
  }
}
