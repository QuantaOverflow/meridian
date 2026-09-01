/**
 * RARR ② 证据切片与逐问题检索（确定性，零 LLM）。
 *
 * 论文对每个问题单独检索、只取 top J=1 证据片段；片段是网页上的「四句滑窗」。
 * 我们的语料是 25 份 markdown 情报报告（一行一个事实），故按行切窗。
 *
 * 为什么不是把整份报告喂给判断步：判断步要回答的是「资料对这一个问题怎么说」，
 * 给它整份报告等于把「找」和「判」又揉回一起——那正是旧做法出错的地方。
 */
import { rankSourcesByRelevance } from '../services/faithfulness-prompts';

export interface EvidenceItem {
  q: string;
  evidence: string;
}

/**
 * 切窗：每 4 行一片、步长 2 行留重叠。
 * 重叠是必要的——不留的话一个事实可能正好被切在两片边界上，两片各拿一半，
 * 检索时哪片都不像答案。
 */
export function buildEvidenceWindows(reports: string[]): string[] {
  const out: string[] = [];
  for (const rep of reports) {
    const lines = rep.split('\n').filter((l) => l.trim());
    for (let i = 0; i < lines.length; i += 2) {
      const w = lines.slice(i, i + 4).join('\n');
      if (w.trim().length > 40) out.push(w);
      if (i + 4 >= lines.length) break;
    }
  }
  return out;
}

/**
 * 每个问题取 top-J 片段。
 *
 * J=1 同论文。原型里先试过 J=2 且不限问题数，17 问题 × 2 片拼出 25KB，比收窄前的 oracle
 * 还大——「每问题一小段」就落空了，判断步又回到大海捞针。
 * maxQ 封顶同理：论文靠采样三次取并集提覆盖，不是靠单次问出十几个。
 *
 * ⚠️ 依赖 `rankSourcesByRelevance` 的实体门。它曾把 How/What 当专名（疑问词不在 STOP 里），
 * 导致正确证据窗口**完全不进候选**——实测含 "219 were injured" 的窗口在原样提问下未进候选、
 * 问句全小写后排第 1。疑问词已补进 STOP；改那份 STOP 时别把它们删了。
 */
export function retrieveEvidence(questions: string[], windows: string[], J = 1, maxQ = 12): EvidenceItem[] {
  if (!windows.length) return [];
  return questions.slice(0, maxQ).map((q) => ({
    q,
    evidence: rankSourcesByRelevance(q, windows, J).map((i) => windows[i]).join('\n…\n'),
  }));
}

export interface AgreementCheck {
  q?: number;
  brief_answer?: string;
  source_answer?: string;
  verdict?: string;
  brief_span?: string;
  replacement?: string;
}

/**
 * 把逐问题判定折成既有的编辑表形状，好复用 applyGroundedEdits 与全部守卫/度量。
 *
 * `reason` 里把两边答案都带上——这是排障时最有用的一行：一眼看出模型认为资料说了什么。
 * 旧路径的 reason 是模型自由写的散文断言（"data does not mention X"），程序无从核对，
 * 实测 43 条里 26 条的说法不成立。
 */
export function checksToEdits(checks: AgreementCheck[]): Array<{
  brief_span: string;
  replacement: string;
  reason: string;
  source_says: string;
}> {
  const out: Array<{ brief_span: string; replacement: string; reason: string; source_says: string }> = [];
  for (const c of checks ?? []) {
    if (!c || c.verdict === 'agree') continue;
    if (typeof c.brief_span !== 'string' || !c.brief_span) continue;
    out.push({
      brief_span: c.brief_span,
      replacement: c.verdict === 'absent' ? '' : String(c.replacement ?? ''),
      reason: `${c.verdict}: brief="${String(c.brief_answer ?? '').slice(0, 60)}" source="${String(c.source_answer ?? '').slice(0, 60)}"`,
      // absent 引不出原话（资料本来就没提），留空；G5 举证对本路径关闭，见调用处注释
      source_says: c.verdict === 'absent' ? '' : String(c.source_answer ?? ''),
    });
  }
  return out;
}
