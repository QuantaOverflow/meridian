#!/usr/bin/env node
// 给一个新部署的 backend 加上起步的 RSS 源（docs/self-hosting.md 第 8 步）。
//
// 走后台接口 POST /admin/sources，不直接写库：这个接口建源的同时拉起它的抓取 Durable Object，
// 直接往 sources 表里插行的话没有 DO 在抓（要再补一次 POST /do/admin/initialize-dos）。
// 可重跑：地址已在库里的源接口回 409，这里当作已存在跳过。
//
// 用法（仓库根）：
//   MERIDIAN_BACKEND_URL=https://meridian-backend.<你的子域>.workers.dev API_TOKEN=<backend 的 API_TOKEN> \
//     node scripts/seed-sources.mjs [源列表.json]
//   源列表缺省是 scripts/sources.json（生产在用的 14 个源）；格式是 [{ name, url, category?, scrape_frequency? }]，
//   scrape_frequency 1–4 = 每 1 / 4 / 6 / 24 小时查一次。
// 退出码：0 = 每个源都已加上或本来就在；1 = 有源没加上；2 = 用法错。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = process.env.MERIDIAN_BACKEND_URL?.replace(/\/+$/, '');
const token = process.env.API_TOKEN;
if (!backend || !token) {
  console.error('要设 MERIDIAN_BACKEND_URL 与 API_TOKEN 两个环境变量');
  process.exit(2);
}
const file = process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), 'sources.json');
let sources;
try {
  sources = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(sources) || sources.some(s => typeof s?.url !== 'string')) throw new Error('要是 [{ url, … }] 的数组');
} catch (error) {
  console.error(`读不了源列表 ${file}：${error.message}`);
  process.exit(2);
}

let failed = 0;
for (const source of sources) {
  const label = source.name ?? source.url;
  try {
    const res = await fetch(`${backend}/admin/sources`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(source),
      signal: AbortSignal.timeout(60_000),
    });
    if (res.status === 201) console.log(`✓ ${label}`);
    else if (res.status === 409) console.log(`· ${label}（已存在）`);
    else {
      failed++;
      console.error(`✗ ${label}：HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
  } catch (error) {
    failed++;
    console.error(`✗ ${label}：${error.message}`);
  }
}
console.log(`${sources.length - failed}/${sources.length} 个源就绪`);
process.exit(failed > 0 ? 1 : 0);
