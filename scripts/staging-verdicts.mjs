#!/usr/bin/env node
// Staging 判定记录（ADR 0013 决定 9）：每次 Staging 运行一行 JSON，记「哪个提交、判成什么」。
// 写的人是 scripts/staging-run.mjs，读的人是 scripts/deploy.sh（部署生产前提醒）。格式只在这个文件里。
//
//   {"at":"<ISO>","workflowId":"cron-brief-…","verdict":"green|yellow|red","flags":[…],
//    "services":{"backend":{"commit":"88ad3e0","dirty":false},"ai-worker":{"commit":"88ad3e0","dirty":false}}}
//
// 放本机（gitignored）：staging 的库每次运行前被重置，放不住。换机器不带过去。
//
// 命令行：node scripts/staging-verdicts.mjs passed <提交哈希>   退出码 0 = 这个提交最近一次 Staging 运行通过，1 = 没通过或没有

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = () => process.env.STAGING_VERDICTS_FILE || path.join(ROOT, '.staging-verdicts.jsonl');

/**
 * 运维台给一次运行打的标记 → 判定。不另写判据（ADR 0013 决定 7）。
 * `late` 是按日历的判据（当天 22 点还没跑完），对随时手动跑的 Staging 运行没有意义，忽略。
 */
export function judge(flags) {
  if (flags.includes('failed') || flags.includes('no_stories')) return 'red';
  return flags.some((f) => f !== 'late') ? 'yellow' : 'green';
}

export function record(entry) {
  fs.appendFileSync(file(), JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
}

/** 两个 worker 当时部署的都是这个提交（短哈希按前缀比）、都不 dirty 的记录里，最近一条是否通过 */
export function passed(commit) {
  let lines;
  try {
    lines = fs.readFileSync(file(), 'utf8').split('\n');
  } catch {
    return false;
  }
  const isCommit = (s) => s?.dirty === false && typeof s.commit === 'string' && s.commit !== '' && (s.commit.startsWith(commit) || commit.startsWith(s.commit));
  let last;
  for (const line of lines) {
    let r;
    try {
      r = JSON.parse(line);
    } catch {
      continue;
    }
    if (isCommit(r?.services?.backend) && isCommit(r?.services?.['ai-worker'])) last = r;
  }
  return last?.verdict === 'green' || last?.verdict === 'yellow';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [cmd, commit] = process.argv.slice(2);
  if (cmd !== 'passed' || !commit) {
    console.error('用法：node scripts/staging-verdicts.mjs passed <提交哈希>');
    process.exit(2);
  }
  process.exit(passed(commit) ? 0 : 1);
}
