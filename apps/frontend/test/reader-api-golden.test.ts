/**
 * 读者与后台读接口（`/api/briefs*`、`/api/countries*`、`/api/search`、`/api/stories*`、`/api/admin/sources*` 的 GET）的响应快照。
 * 真实构建并启动 Nuxt 服务（node-server preset），backend 用本文件起的 HTTP 服务假冒：它回放 backend 自己的快照
 * （apps/backend/test/fixtures/reader/__golden__/，由 backend 的 reader.spec.ts 对同一份 fixture 跑真实路由生成），
 * 前端的输出再与 `__golden__/reader-api/` 比对。后者是前端还直连数据库时对同一份 fixture 录下的，
 * 所以两段都绿 = 搬到 backend 前后 `/api/*` 的响应逐字节一致（状态码、cache-control、响应体原文）。
 * 只拦「改动改变了响应」，不判断对错。日期换成相对记号，见 apps/backend/test/fixtures/reader/dates.ts。
 */
import http from 'node:http';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { fetch, setup } from '@nuxt/test-utils/e2e';
import { anchorFromDate, detokenizeDates, tokenizeDates } from '../../backend/test/fixtures/reader/dates';

// 回放用的「今天」取一个固定日期：前端不再依赖当前时间（天数由 backend 算好）。
// 取在年初，让 fixture 的日期跨年，顺带验证短日期「M 月 D 日」的记号换算
const anchor = anchorFromDate('2026-01-10');
const TOKEN = 'test-token';

// ── 假 backend：按请求路径回放 backend 快照 ─────────────────────────────
const BACKEND_GOLDEN = fileURLToPath(new URL('../../backend/test/fixtures/reader/__golden__/', import.meta.url));
const replies = new Map<string, { status: number; body: string }>();
for (const file of readdirSync(BACKEND_GOLDEN)) {
  const text = readFileSync(`${BACKEND_GOLDEN}${file}`, 'utf8');
  const newline = text.indexOf('\n');
  const meta = JSON.parse(text.slice(0, newline)) as { status: number; path: string };
  replies.set(meta.path, { status: meta.status, body: detokenizeDates(text.slice(newline + 1).trimEnd(), anchor) });
}

const unexpected: string[] = [];
const backend = http.createServer((req, res) => {
  const reply = replies.get(req.url ?? '');
  if (req.method !== 'GET' || req.headers.authorization !== `Bearer ${TOKEN}` || reply === undefined) {
    unexpected.push(`${req.method} ${req.url} (${req.headers.authorization})`);
    res.statusCode = 500;
    res.end();
    return;
  }
  res.statusCode = reply.status;
  res.setHeader('content-type', 'application/json');
  res.end(reply.body);
});
await new Promise<void>(r => backend.listen(0, '127.0.0.1', () => r()));
const backendUrl = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;

const ADMIN = { username: 'test-admin', password: 'test-pass' };

await setup({
  rootDir: fileURLToPath(new URL('..', import.meta.url)),
  nuxtConfig: { nitro: { preset: 'node-server' } },
  env: {
    // 与生产（Cloudflare，UTC）一致
    TZ: 'UTC',
    NUXT_PUBLIC_WORKER_API: backendUrl,
    NUXT_WORKER_API_TOKEN: TOKEN,
    NUXT_ADMIN_USERNAME: ADMIN.username,
    NUXT_ADMIN_PASSWORD: ADMIN.password,
    NUXT_SESSION_PASSWORD: 'test-session-password-at-least-32-chars',
  },
});

afterAll(() => {
  backend.close();
});

async function loginCookie(): Promise<string> {
  const res = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(ADMIN),
  });
  expect(res.status).toBe(201);
  return res.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
}

/** golden 名 → 请求路径；后台那组带登录会话 */
const READER_CASES: Record<string, string> = {
  'briefs-list': '/api/briefs',
  'briefs-list-page': '/api/briefs?limit=3&offset=2',
  'briefs-search-hit': '/api/briefs?q=ukraine',
  'briefs-search-percent': '/api/briefs?q=100%25',
  'briefs-search-miss': '/api/briefs?q=zzz-no-match',
  'briefs-invalid-query': '/api/briefs?limit=0',
  'briefs-latest': '/api/briefs/latest',
  'brief-3-top-stories': '/api/briefs/3',
  'brief-1-legacy': '/api/briefs/1',
  'brief-2-artifacts': '/api/briefs/2',
  'brief-404': '/api/briefs/999',
  'brief-invalid-slug': '/api/briefs/abc',
  'brief-8-map': '/api/briefs/8/map',
  // 国家页的一节：代码转大写、缺省的 limit / offset 补齐后转发
  'country-il-placement': '/api/countries/IL/blocks?section=placement',
  'country-il-placement-page': '/api/countries/il/blocks?section=placement&limit=1&offset=1',
  'country-il-mention': '/api/countries/IL/blocks?section=mention',
  'country-jp-empty': '/api/countries/JP/blocks',
  'country-404': '/api/countries/QQ/blocks',
  'country-invalid-code': '/api/countries/ISR/blocks',
  'country-invalid-query': '/api/countries/IL/blocks?section=both',
  // 搜索：查询串去首尾空白、缺省的 limit / offset 补齐后转发；空查询与超长查询不转发，直接 400
  'search-gaza': '/api/search?q=%20gaza%20',
  'search-holding-page': '/api/search?q=holding&limit=1&offset=1',
  'search-miss': '/api/search?q=zzz-no-match',
  'search-empty-query': '/api/search?q=%20',
  'search-missing-query': '/api/search',
  'search-too-long': `/api/search?q=${'a'.repeat(201)}`,
  'search-invalid-query': '/api/search?q=gaza&limit=0',
  'stories-list': '/api/stories',
  'story-1-streak': '/api/stories/1',
  'story-2-importance': '/api/stories/2',
  'story-3-disputed': '/api/stories/3',
  'story-4-dormant': '/api/stories/4',
  'story-5-below-threshold': '/api/stories/5',
  'story-invalid-id': '/api/stories/0',
};
const ADMIN_CASES: Record<string, string> = {
  'admin-source-1-details': '/api/admin/sources/1/details',
  'admin-source-1-page-2': '/api/admin/sources/1/details?page=2',
  'admin-source-1-processed-asc': '/api/admin/sources/1/details?status=PROCESSED&sortBy=processedAt&sortOrder=asc',
  'admin-source-1-junk': '/api/admin/sources/1/details?quality=JUNK',
  'admin-source-1-partial-by-published': '/api/admin/sources/1/details?completeness=PARTIAL_USEFUL&sortBy=publishedAt',
  'admin-source-1-invalid-filters': '/api/admin/sources/1/details?status=NOPE&sortOrder=weird&page=x',
  'admin-source-2-details': '/api/admin/sources/2/details',
  'admin-source-3-paused-empty': '/api/admin/sources/3/details',
  'admin-source-404': '/api/admin/sources/999/details',
  'admin-source-invalid-id': '/api/admin/sources/abc/details',
};

async function snapshot(name: string, path: string, cookie?: string) {
  const res = await fetch(path, cookie === undefined ? undefined : { headers: { cookie } });
  const meta = JSON.stringify({ status: res.status, 'cache-control': res.headers.get('cache-control') });
  // 错误响应体里带请求的完整 URL，端口每次随机
  const body = tokenizeDates(await res.text(), anchor).replace(/http:\/\/127\.0\.0\.1:\d+/g, '{server}');
  const text = `${meta}\n${body}\n`;
  await expect(text).toMatchFileSnapshot(`./__golden__/reader-api/${name}.golden`);
  // 前端转发的每条请求都必须命中一份 backend 快照（路径、方法、token 都对）
  expect(unexpected).toEqual([]);
}

describe('读者接口快照', () => {
  for (const [name, path] of Object.entries(READER_CASES)) {
    it(name, () => snapshot(name, path));
  }
});

describe('后台源读接口快照', () => {
  for (const [name, path] of Object.entries(ADMIN_CASES)) {
    it(name, async () => snapshot(name, path, await loginCookie()));
  }

  // 没登录：单个源的详情接口回 401（全部后台接口的登录门见 admin-api-auth.test.ts）
  it('admin-source-no-session', () => snapshot('admin-source-no-session', '/api/admin/sources/1/details'));
});

// ── 地图首页：服务端渲染出来的顶部与右侧面板 ──────────────────────────
// 期望值写死自 backend 的 brief-8-map / briefs-latest 快照：story 15 是头条（块 0、线索 1 出现在 3 期），
// story 16 不是头条；正文 2 条；主题 security、economy 各 1 条
describe('地图首页（SSR）', () => {
  const text = (inner: string) => inner.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  /** 页面里每个 <a> 的 href 与去标签后的文字 */
  const anchors = (html: string) =>
    [...html.matchAll(/<a\b[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(([, href, inner]) => ({
      href: href.replace(/&amp;/g, '&'),
      text: text(inner),
    }));

  it('首屏：阅读入口、头条卡片、线索、其余条数、主题标签、往期入口、规范地址', async () => {
    const res = await fetch('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    const links = anchors(html);

    expect(links).toContainEqual({ href: '/briefs/8', text: 'Read today’s brief →' });
    expect(links).toContainEqual({ href: '/briefs', text: 'Past briefs' });
    expect(links).toContainEqual({ href: '/stories/1', text: 'Tracking · issue 3' });
    // 头条卡片只有 story 15；不是头条的 story 16 不出卡片，算进「其余 1 条」
    expect(links.filter(l => l.text === 'Read this part →').map(l => l.href)).toEqual(['/briefs/8#story-1']);
    expect(links).toContainEqual({ href: '/briefs/8#story-2', text: '1 more in the brief →' });

    const tags = [...html.matchAll(/<button\b[^>]*data-topic="([a-z]+)"[^>]*>([\s\S]*?)<\/button>/g)].map(([, key, inner]) => [
      key,
      text(inner),
    ]);
    expect(tags.sort()).toEqual([
      ['economy', 'Economy 1'],
      ['security', 'Conflict & Security 1'],
    ]);

    // 首页有自己的规范地址，不指向某一期的阅读页
    expect(html).toMatch(/<link[^>]*rel="canonical"[^>]*href="http:\/\/[^"]+\/"/);
    expect(html).not.toMatch(/rel="canonical"[^>]*\/briefs\//);
    expect(unexpected).toEqual([]);
  });

  // 首页从 @meridian/contracts 引落点规则（运行时 import）；contracts 的入口把 ai-worker.ts 的 zod schema 也带出来，
  // 打包器摇不掉的话每个读者首屏都要多下一个约 60KB 的库
  it('首屏的脚本（页面引的 chunk 及它们静态 import 的）里没有 zod', async () => {
    const html = await (await fetch('/')).text();
    const queue = [...html.matchAll(/(?:href|src)="(\/_nuxt\/[^"]+\.js)"/g)].map(m => m[1]);
    expect(queue.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    const withZod: string[] = [];
    while (queue.length > 0) {
      const path = queue.pop()!;
      if (seen.has(path)) continue;
      seen.add(path);
      const res = await fetch(path);
      expect(res.status, path).toBe(200);
      const code = await res.text();
      if (code.includes('ZodError')) withZod.push(path);
      // 只跟静态 import（`import"./x.js"`、`from"./x.js"`）；`import("./x.js")` 是按需加载，不算首屏
      for (const m of code.matchAll(/(?:import|from)\s*"\.\/([^"]+\.js)"/g)) queue.push(`/_nuxt/${m[1]}`);
    }
    expect(withZod).toEqual([]);
  });

  it('地图数据取不到：顶部与阅读入口照常，面板处写明', async () => {
    const saved = replies.get('/reader/briefs/8/map')!;
    replies.set('/reader/briefs/8/map', { status: 500, body: '{"error":"boom"}' });
    try {
      const res = await fetch('/');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(anchors(html)).toContainEqual({ href: '/briefs/8', text: 'Read today’s brief →' });
      expect(html).toContain('Map data is unavailable right now.');
      expect(html).not.toContain('data-topic=');
    } finally {
      replies.set('/reader/briefs/8/map', saved);
    }
  });
});

// ── 国家页：两节（落点在该国 / 涉及该国），期望值写死自 backend 的 country-il-* 快照 ──────────
describe('国家页（SSR）', () => {
  const text = (inner: string) => inner.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  /** 一节里各块的标题与「读这一块」链接，按页面顺序 */
  const blocksIn = (html: string, section: string) => {
    const start = html.indexOf(`data-section="${section}"`);
    if (start === -1) return null;
    const rest = html.slice(start);
    const end = rest.indexOf('</section>');
    const part = rest.slice(0, end === -1 ? undefined : end);
    return [...part.matchAll(/<h3\b[^>]*>([\s\S]*?)<\/h3>[\s\S]*?<a\b[^>]*?href="(\/briefs\/[^"]*)"/g)].map(([, title, href]) => [text(title), href]);
  };

  it('以色列：落点在该国的三块按期倒序，涉及该国的一块单列并写明落点不在该国；未发布那期的块不出现', async () => {
    const res = await fetch('/countries/IL');
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toMatch(/<h1\b[^>]*>\s*Israel\s*<\/h1>/);
    expect(blocksIn(html, 'placement')).toEqual([
      ['gaza ceasefire holds', '/briefs/8#story-1'],
      ['hostage deal', '/briefs/7#story-1'],
      ['gaza talks in cairo', '/briefs/6#story-1'],
    ]);
    expect(blocksIn(html, 'mention')).toEqual([['iran sanctions', '/briefs/7#story-2']]);
    // 正文按段落渲染
    expect(html).toContain('<p>The ceasefire held for a third day.</p>');
    expect(html).toContain('<p>Aid deliveries rose.</p>');
    // 涉及的那块：还涉及伊朗
    expect(text(html)).toContain('Also involves Iran');
    expect(html).not.toContain('ukraine debug');
    expect(unexpected).toEqual([]);
  });

  it('小写代码照常打开', async () => {
    const html = await (await fetch('/countries/il')).text();
    expect(blocksIn(html, 'placement')?.length).toBe(3);
  });

  it('表里有、但没有任何块的国家：200，写明还没有', async () => {
    const res = await fetch('/countries/JP');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<h1\b[^>]*>\s*Japan\s*<\/h1>/);
    expect(text(html)).toContain('No stories about Japan in the briefs yet.');
    expect(blocksIn(html, 'placement')).toBeNull();
    expect(blocksIn(html, 'mention')).toBeNull();
    expect(unexpected).toEqual([]);
  });

  it('不认得的国家代码：404', async () => {
    expect((await fetch('/countries/QQ')).status).toBe(404);
    expect((await fetch('/countries/ISR')).status).toBe(404);
  });

  it('地图首页锁定一个国家后，面板里有进国家页的入口（?country= 打开时即锁定）', async () => {
    const html = await (await fetch('/?country=IL')).text();
    expect(html).toMatch(/<a\b[^>]*href="\/countries\/IL"[^>]*>[\s\S]*?All coverage of Israel/);
    // 没锁定时没有这个入口
    expect(await (await fetch('/')).text()).not.toContain('href="/countries/');
  });
});

// ── 搜索页：结果按线索折叠，期望值写死自 backend 的 search-* 快照 ──────────
describe('搜索页（SSR）', () => {
  const text = (inner: string) => inner.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  /** 每组：线索链接（没有为 null）、直接露出的块、折在「展开」里的块；块 = [标题, 读这一块的链接] */
  const groups = (html: string) =>
    html.split('data-search-group').slice(1).map(part => {
      const end = part.indexOf('</article>');
      const group = part.slice(0, end === -1 ? undefined : end);
      const blocks = (chunk: string) =>
        [...chunk.matchAll(/<h[34]\b[^>]*>([\s\S]*?)<\/h[34]>[\s\S]*?<a\b[^>]*?href="(\/briefs\/[^"]*)"/g)].map(([, title, href]) => [text(title), href]);
      const fold = group.indexOf('<details');
      const thread = /<a\b[^>]*?href="(\/stories\/\d+)"[^>]*>([\s\S]*?)<\/a>/.exec(group);
      return {
        thread: thread === null ? null : [thread[1], text(thread[2])],
        shown: blocks(fold === -1 ? group : group.slice(0, fold)),
        folded: fold === -1 ? [] : blocks(group.slice(fold)),
      };
    });

  it('同一线索的两块折成一组：最新那块直接露出，另一块在展开里；带线索页的链接', async () => {
    const res = await fetch('/search?q=gaza');
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(groups(html)).toEqual([
      {
        thread: ['/stories/1', 'Gaza — ceasefire holds · 3 issues'],
        shown: [['gaza ceasefire holds', '/briefs/8#story-1']],
        folded: [['gaza talks in cairo', '/briefs/6#story-1']],
      },
    ]);
    expect(text(html)).toContain('1 more from this thread');
    expect(text(html)).toContain('2 matching stories');
    // 搜索框里留着查询串；正文按段落渲染
    const box = /<input\b[^>]*name="q"[^>]*>/.exec(html)?.[0];
    expect(box).toContain('value="gaza"');
    expect(html).toContain('<p>Aid deliveries rose.</p>');
    expect(unexpected).toEqual([]);
  });

  it('两组：有线索的一组带线索链接，没有线索的一组不带', async () => {
    const html = await (await fetch('/search?q=holding')).text();
    expect(groups(html)).toEqual([
      { thread: ['/stories/1', 'Gaza — ceasefire holds · 3 issues'], shown: [['gaza ceasefire holds', '/briefs/8#story-1']], folded: [] },
      { thread: null, shown: [['fed holds rates', '/briefs/8#story-2']], folded: [] },
    ]);
    expect(unexpected).toEqual([]);
  });

  it('没命中：200，写明没有结果', async () => {
    const res = await fetch('/search?q=zzz-no-match');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(text(html)).toContain('No stories match “zzz-no-match”.');
    expect(groups(html)).toEqual([]);
    expect(unexpected).toEqual([]);
  });

  it('没带查询串、只有空白：只出搜索框与说明，不去问 backend', async () => {
    for (const path of ['/search', '/search?q=', '/search?q=%20%20']) {
      const res = await fetch(path);
      expect(res.status, path).toBe(200);
      const html = await res.text();
      expect(html, path).toMatch(/<input\b[^>]*name="q"/);
      expect(text(html), path).toContain('Search the stories in every published brief.');
      expect(groups(html), path).toEqual([]);
    }
    expect(unexpected).toEqual([]);
  });

  it('查询串超过 200 字：写明上限，不去问 backend', async () => {
    const res = await fetch(`/search?q=${'a'.repeat(201)}`);
    expect(res.status).toBe(200);
    expect(text(await res.text())).toContain('Search queries can be at most 200 characters.');
    expect(unexpected).toEqual([]);
  });

  it('导航栏有搜索入口：读者页与地图首页', async () => {
    for (const path of ['/search', '/stories', '/']) {
      expect(await (await fetch(path)).text(), path).toMatch(/<a\b[^>]*href="\/search"/);
    }
  });
});

describe('backend 故障', () => {
  it('backend 回 5xx：前端回 502', async () => {
    replies.set('/reader/stories', { status: 500, body: '{"error":"boom"}' });
    expect((await fetch('/api/stories')).status).toBe(502);
  });
});
