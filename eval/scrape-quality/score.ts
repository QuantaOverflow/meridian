// Scrape-quality eval:验证生产的抓取/解析失败检测器(looksLikeExtractionFailure +
// looksLikeNonArticleUrl)在开放编码金标上的 precision/recall,并对比 pipeline 的 content_quality 门。
// 直接 import 生产真函数(单一真源、免副本漂移)。
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  looksLikeExtractionFailure,
  looksLikeNonArticleUrl,
} from '../../../apps/backend/src/lib/core/extraction-quality.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readJsonl = (p: string) =>
  readFileSync(resolve(__dirname, p), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

interface GoldRow { id: number; url: string; pipeline_q: string; gold_cat: string; is_extraction_failure: boolean; }
const gold: GoldRow[] = readJsonl('gold/gold.jsonl');
const content: Record<number, string> = Object.fromEntries(readJsonl('gold/content.jsonl').map((r: any) => [r.id, r.text]));

// 生产同款判定:URL 结构规则 + 内容签名
function detect(row: GoldRow): { fail: boolean; by: string } {
  const u = row.url ? looksLikeNonArticleUrl(row.url) : null;
  if (u) return { fail: true, by: `url:${u}` };
  const t = looksLikeExtractionFailure(content[row.id] ?? '');
  return { fail: t.fail, by: t.fail ? `sig:${t.reason}` : '' };
}

let tp = 0, fp = 0, tn = 0, fn = 0;
const fpList: string[] = [], fnList: string[] = [];
for (const r of gold) {
  const d = detect(r);
  if (r.is_extraction_failure) d.fail ? tp++ : (fn++, fnList.push(`${r.id} ${r.gold_cat}`));
  else d.fail ? (fp++, fpList.push(`${r.id} ${r.gold_cat} by=${d.by}`)) : tn++;
}
const prec = tp / (tp + fp || 1), rec = tp / (tp + fn || 1);
console.log(`Scrape-quality 检测器 vs 金标(n=${gold.length},真失败=${tp + fn}):`);
console.log(`  TP=${tp} FP=${fp} TN=${tn} FN=${fn}  precision=${prec.toFixed(2)} recall=${rec.toFixed(2)}`);
console.log(`  漏报(FN):`, fnList.join(' | ') || '无');
console.log(`  误报(FP):`, fpList.join(' | ') || '无');

// pipeline content_quality 门 vs 金标
console.log('\npipeline content_quality × gold:');
for (const q of ['JUNK', 'LOW_QUALITY', 'OK']) {
  const sub = gold.filter((r) => r.pipeline_q === q);
  const fail = sub.filter((r) => r.is_extraction_failure).length;
  const real = sub.filter((r) => r.gold_cat === 'A').length;
  console.log(`  ${q.padEnd(12)} n=${sub.length}: 抓取失败 ${fail} | 真文章A ${real} | 低值C ${sub.filter((r) => r.gold_cat === 'C').length}`);
}

// 接受闸:precision=1.0(不误杀真文章) + recall≥0.85
const pass = fp === 0 && rec >= 0.85;
console.log(`\nGATE(precision=1.0 且 recall≥0.85): ${pass ? 'PASS ✅' : 'FAIL ❌'}`);
process.exit(pass ? 0 : 1);
