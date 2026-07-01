// ============================================================================
// 情报层数据形态适配 —— 从 observability 的 intelligence_analysis LLM 调用里，
// 拆出 grounding eval 需要的两端：
//   SOURCE        = 喂给情报分析的输入 RSS 文章（prompt 里 <articles>…</articles> 内的全文）
//   被评对象 prose = 情报报告里所有需要核对的文字（executiveSummary / timeline / 推断 / 矛盾 / 缺口）
//
// 为什么 source 只取 <articles> 块：情报 prompt = 指令脚手架 + 文章 + 输出要求。指令脚手架不是
// "事实来源"，把它当 source 会让 judge 误以为指令文本能支撑 claim。grounding 的真相源只有文章本身。
// ============================================================================

import { AIResponseParser } from '../../../services/meridian-ai-worker/src/utils/ai-response-parser.js';

// 从情报 prompt 里抠出 <articles>…</articles> 之间的输入文章全文（即 buildArticleMarkdown 的产物）。
// 找不到标签时退化为整段 prompt（保证不致命，但会在调用处告警）。
export function extractSourceArticles(prompt: string): { source: string; bounded: boolean } {
  const start = prompt.indexOf('<articles>');
  const end = prompt.indexOf('</articles>');
  if (start !== -1 && end !== -1 && end > start) {
    return { source: prompt.slice(start + '<articles>'.length, end).trim(), bounded: true };
  }
  return { source: prompt.trim(), bounded: false };
}

// 把情报报告的结构化 JSON 摊平成一段可抽 claim 的 prose。
// 只取"对事实有断言"的字段；纯枚举/分类标签（importance=HIGH 之类）不进 prose。
// 解析复用 runtime 的 parseIntelligenceResponse（容忍 <final_json> / ```json / 裸对象 三种形态）。
export function intelReportToProse(rawResponse: string): { prose: string; parsedOk: boolean } {
  const r: any = AIResponseParser.parseIntelligenceResponse(rawResponse);
  if (!r || r.status === 'incomplete') {
    return { prose: '', parsedOk: false };
  }

  const parts: string[] = [];
  const pushStr = (label: string, v: unknown) => {
    if (typeof v === 'string' && v.trim()) parts.push(`[${label}] ${v.trim()}`);
  };

  pushStr('summary', r.executiveSummary);
  pushStr('signal', r.signalStrength?.reasoning);
  pushStr('significance', r.significance?.reasoning ?? (typeof r.significance === 'string' ? r.significance : undefined));

  // timeline：每个事件的 description 是按时序的事实断言
  if (Array.isArray(r.timeline)) {
    for (const e of r.timeline) {
      if (typeof e === 'string') pushStr('timeline', e);
      else pushStr('timeline', e?.description);
    }
  }

  // keyEntities：实体的角色/描述是对其行为的断言（兼容 list / 扁平数组）
  const entityList = Array.isArray(r.keyEntities)
    ? r.keyEntities
    : Array.isArray(r.keyEntities?.list)
      ? r.keyEntities.list
      : Array.isArray(r.entities)
        ? r.entities
        : [];
  for (const ent of entityList) {
    const role = ent?.role || ent?.description;
    if (ent?.name && typeof role === 'string' && role.trim()) {
      pushStr('entity', `${ent.name}: ${role}`);
    }
  }

  if (Array.isArray(r.factualBasis)) for (const f of r.factualBasis) pushStr('factualBasis', f);

  // contradictions：报告声称"源里存在的冲突"——本身就是对源的事实断言（冲突真存在吗？）
  if (Array.isArray(r.contradictions)) {
    for (const c of r.contradictions) {
      pushStr('contradiction', c?.issue);
      if (Array.isArray(c?.conflictingClaims)) {
        for (const cc of c.conflictingClaims) pushStr('contradiction-claim', cc?.statement);
      }
    }
  }

  // informationGaps：是 analytical（"缺什么"是判断），照抽，judge 会按 analytical 通道处理
  if (Array.isArray(r.informationGaps)) for (const g of r.informationGaps) pushStr('infoGap', g);

  return { prose: parts.join('\n'), parsedOk: true };
}
