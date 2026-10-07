// 把近几天文章的正文从生产 bucket 拷到 staging bucket（ADR 0013 决定 4）。scripts/staging-run.mjs 在 reset 之后调。
//
// 为什么要拷：简报 workflow 严格从 R2 取正文、取不到不回退，而 staging 的 bucket 是自己的一份。
// 怎么拷：经 Cloudflare REST，只读生产、只写 staging（两个 bucket 名写死在下面）；staging 已有的跳过。
// REST 对账户限速（约 1200 次 / 5 分钟），一篇读写各一次：头一次拷一两千篇要等几分钟，之后每次只拷新增的。

import { spawnSync } from 'node:child_process';

const FROM = 'meridian-articles-prod';
const TO = 'meridian-articles-staging';
const CONCURRENCY = 4;
const MAX_ATTEMPTS = 20;

/** @returns {Promise<{ wanted: number, alreadyThere: number, copied: number, missingInProd: number, failed: string[] }>} */
export async function copyBodies({ accountId, token, databaseUrl, days }) {
  const objects = (bucket, suffix) => `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/objects${suffix}`;

  // 被限速（429）按 retry-after 等了再试；别的失败隔两秒再试
  async function request(method, url, body) {
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(url, { method, body, headers: { Authorization: `Bearer ${token}` } }).catch(() => null);
      if (res && (res.ok || res.status === 404)) return res;
      if (attempt >= MAX_ATTEMPTS) return res ?? { ok: false, status: 0 };
      const retryAfter = Number(res?.headers.get('retry-after'));
      await new Promise((r) => setTimeout(r, res?.status === 429 ? (retryAfter > 0 ? retryAfter * 1000 : 30_000) : 2_000));
    }
  }

  async function keysUnder(bucket, prefix) {
    const keys = [];
    let cursor = '';
    do {
      const res = await request('GET', objects(bucket, `?per_page=1000&prefix=${encodeURIComponent(prefix)}${cursor && `&cursor=${encodeURIComponent(cursor)}`}`));
      if (!res.ok) throw new Error(`列 ${bucket} 的对象失败：HTTP ${res.status}`);
      const page = await res.json();
      keys.push(...(page.result ?? []).map((o) => o.key));
      cursor = page.result_info?.is_truncated ? page.result_info.cursor : '';
    } while (cursor);
    return keys;
  }

  // 要哪些：staging 库（刚 reset，就是生产的副本）里近几天、已处理、有正文的文章
  const query = spawnSync(
    'psql',
    [databaseUrl, '-At', '-c', `select content_file_key from articles where content_file_key is not null and status = 'PROCESSED' and publish_date >= now() - interval '${Number(days)} days'`],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
  if (query.status !== 0) throw new Error(`查要拷的正文清单失败（psql 退出码 ${query.status ?? query.error?.message}）`);
  const wanted = query.stdout.split('\n').map((l) => l.trim()).filter(Boolean);

  // 已有哪些：正文的 key 是 年/月/日/id.txt，按日前缀列
  const dayPrefixes = [...new Set(wanted.map((k) => k.slice(0, k.lastIndexOf('/') + 1)))];
  const have = new Set((await Promise.all(dayPrefixes.map((p) => keysUnder(TO, p)))).flat());
  const todo = wanted.filter((k) => !have.has(k));

  let missingInProd = 0;
  const failed = [];
  let next = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (next < todo.length) {
      const key = todo[next++];
      const at = '/' + encodeURIComponent(key);
      const got = await request('GET', objects(FROM, at));
      if (got.status === 404) missingInProd++;
      else if (!got.ok) failed.push(`${key}（读 ${got.status}）`);
      else {
        const put = await request('PUT', objects(TO, at), await got.arrayBuffer());
        if (!put.ok) failed.push(`${key}（写 ${put.status}）`);
      }
    }
  }));
  return { wanted: wanted.length, alreadyThere: wanted.length - todo.length, copied: todo.length - missingInProd - failed.length, missingInProd, failed };
}
