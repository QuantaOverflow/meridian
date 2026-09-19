/**
 * Scorer 的身份指纹。**「判据变了旧读数作废」这条规则的机械形态。**
 *
 * 为什么要有:CONTEXT.md 写着「实现层中途不得改判据;判据变了就是新的一把尺,旧读数作废」,
 * 但在 2026-09-19 之前这条只是文字 —— 换了证据通道之后,全靠人记得把旧 verdict 移走。
 * 记不住的那一次,新旧读数会混在同一张表里比较,而且**不报错**。
 *
 * 指纹从内容算,不手写版本号:手写的会忘记改,而忘记改恰好等于关掉这道闸。
 *
 * 两个指纹,各管一种失效:
 *   · `packId`      = 判定包 markdown 的哈希 —— **判官到底看到了什么**。
 *                     包一变(守则改了、清单重抽了、检索结果变了、成稿变了),旧判定就不再对应这份材料。
 *                     这是最准的一个:它不依赖"哪些文件算 scorer"这种需要人维护的清单。
 *   · `scorerSrcId` = grading instructions + 检索实现 + topK 的哈希 —— 抓「尺改了但判定包没重建」。
 *                     这种情况下包的内容还是旧的,`packId` 对得上,只有源码指纹能发现。
 *
 * **不包含 `score-slow.mjs`**:判定的有效性取决于判官看到了什么,而 score-slow 只是事后汇总,
 * 每次都从 verdict 重算。把它算进指纹会让"改了一行汇总逻辑"作废掉一批还有效的判定。
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TOPK } from './retrieval.mjs';
import { gradingInstructions } from './grading-instructions.mjs';

const HERE = new URL('.', import.meta.url).pathname;
const short = s => createHash('sha256').update(s).digest('hex').slice(0, 10);

/** 判定包内容的指纹。传生成好的 markdown。 */
export const packId = md => short(md);

/** 尺本身的指纹:守则 + 检索实现 + 旋钮。 */
export function scorerSrcId() {
  return short([
    gradingInstructions().join('\n'),
    readFileSync(`${HERE}retrieval.mjs`, 'utf8'),
    `#topK=${TOPK}`,
  ].join('\n----\n'));
}
