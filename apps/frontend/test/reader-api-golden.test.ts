/**
 * 读者与后台读接口（`/api/briefs*`、`/api/countries*`、`/api/entities*`、`/api/following`、`/api/search`、`/api/stories*`、`/api/admin/sources*` 的 GET）的响应快照。
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
import { createPage, fetch, setup, url } from '@nuxt/test-utils/e2e';
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

// 块下的实体链接（/reader/block-entities?ids=…）：backend 只录一份「fixture 里全部块」的快照，任意一批块号的请求
// 从它里面按请求的顺序挑，与真接口同口径（没有实体的块不在结果里；顺序与子集的行为由 backend 的 reader.spec.ts 对真路由测）。
// 请求里有没录到的块号时不回放（记进 unexpected）：说明 backend 的 fixture 加了块而那份快照没跟上
const BLOCK_ENTITIES = '/reader/block-entities?ids=';
const idsOf = (path: string) => path.slice(BLOCK_ENTITIES.length).split(',').map(Number);
const allBlockEntities = [...replies].find(([path]) => path.startsWith(BLOCK_ENTITIES));
if (allBlockEntities === undefined) throw new Error('backend 快照里没有 block-entities-all');
const recordedBlockIds = new Set(idsOf(allBlockEntities[0]));
const recordedBlockEntities = (JSON.parse(allBlockEntities[1].body) as { items: { blockId: number }[] }).items;
function blockEntitiesReply(path: string): { status: number; body: string } | undefined {
  if (!path.startsWith(BLOCK_ENTITIES)) return undefined;
  const ids = idsOf(path);
  if (ids.some(id => !recordedBlockIds.has(id))) return undefined;
  return { status: 200, body: JSON.stringify({ items: ids.flatMap(id => recordedBlockEntities.filter(item => item.blockId === id)) }) };
}

const unexpected: string[] = [];
const backend = http.createServer((req, res) => {
  const reply = replies.get(req.url ?? '') ?? blockEntitiesReply(req.url ?? '');
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
  // Following 页的关注项在浏览器的 localStorage 里，那一组要真浏览器
  browser: true,
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
  // 搜索：查询串去首尾空白、缺省的 limit / offset 补齐后转发；空查询、超长查询、带 NUL 的查询与过大的 offset 不转发，直接 400
  'search-gaza': '/api/search?q=%20gaza%20',
  'search-holding-page': '/api/search?q=holding&limit=1&offset=1',
  'search-miss': '/api/search?q=zzz-no-match',
  'search-empty-query': '/api/search?q=%20',
  'search-missing-query': '/api/search',
  'search-too-long': `/api/search?q=${'a'.repeat(201)}`,
  'search-invalid-query': '/api/search?q=gaza&limit=0',
  // NUL 字符与过大的 offset 到了 Postgres 都是报错，同样不转发
  'search-nul-query': '/api/search?q=a%00b',
  'search-offset-too-large': '/api/search?q=gaza&offset=99999999999999999999',
  // Following：关注项去重、排序、国家代码转大写、缺省的 limit / offset 补齐后转发；没有关注项不转发，直接回空页
  'following-il': '/api/following?countries=il',
  'following-il-thread-2': '/api/following?threads=2&countries=IL,il',
  'following-il-thread-2-page': '/api/following?countries=IL&threads=2,2&limit=2&offset=1',
  'following-thread-1': '/api/following?threads=1',
  'following-miss': '/api/following?countries=JP',
  'following-none': '/api/following',
  'following-invalid-country': '/api/following?countries=ISR',
  'following-invalid-thread': '/api/following?threads=1,abc',
  // 实体页：写法归一（小写、去首尾空白）、缺省的 limit / offset 补齐后转发；没过门槛 404；能归成国家的回国家页的地址；
  // 缺写法、空写法、超长的写法不转发，直接 400
  'entity-netanyahu': '/api/entities/blocks?name=%20Benjamin%20NETANYAHU%20',
  'entity-netanyahu-page': '/api/entities/blocks?name=benjamin%20netanyahu&limit=2&offset=1',
  'entity-hamas-below-threshold': '/api/entities/blocks?name=hamas',
  'entity-iran-country': '/api/entities/blocks?name=Iran',
  // 实体列表页与阅读页每块下的实体链接
  'entities-list': '/api/entities',
  'brief-8-entities': '/api/briefs/8/entities',
  'brief-entities-invalid-slug': '/api/briefs/abc/entities',
  'entity-missing-name': '/api/entities/blocks',
  'entity-empty-name': '/api/entities/blocks?name=%20',
  'entity-too-long': `/api/entities/blocks?name=${'a'.repeat(201)}`,
  // Following 带实体：一个实体一个参数，归一、去重后转发
  'following-entity': '/api/following?entities=Benjamin%20Netanyahu&entities=benjamin%20netanyahu',
  'following-invalid-entity': '/api/following?entities=%20',
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
    expect(links).toContainEqual({ href: '/stories/1', text: 'Tracking · 3 briefs' });
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
        thread: ['/stories/1', 'Gaza — ceasefire holds · 3 briefs'],
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
      { thread: ['/stories/1', 'Gaza — ceasefire holds · 3 briefs'], shown: [['gaza ceasefire holds', '/briefs/8#story-1']], folded: [] },
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

// ── 关注与 Following 页：关注项与上次访问的时刻在浏览器的 localStorage 里，用真浏览器走 ──────────
// 期望值写死自 backend 的 following-* 快照；回放的「今天」是 2026-01-10，第 8、7、6 期分别生成于 01-10、01-09、01-08 的 12:00（UTC）
describe('关注与 Following 页（浏览器）', () => {
  type Page = Awaited<ReturnType<typeof createPage>>;
  const FOLLOWS_KEY = 'meridian-follows';
  const LAST_VISIT_KEY = 'meridian-following-last-visit';
  const IL = JSON.stringify([{ kind: 'country', code: 'IL' }]);

  /** 新的浏览器上下文（localStorage 是空的）；init 在每次打开页面、页面脚本之前跑 */
  async function openBrowser(init?: { script: (stored: Record<string, string>) => void; stored?: Record<string, string> }) {
    const page = await createPage();
    // 只放行本地服务：页面 <head> 引 Google Fonts，外网慢时 goto 会等到超时
    await page.route('**/*', route => {
      const host = new URL(route.request().url()).hostname;
      return host === '127.0.0.1' || host === 'localhost' ? route.continue() : route.abort();
    });
    if (init) await page.addInitScript(init.script, init.stored ?? {});
    return page;
  }
  /** 带着预先存好的 localStorage 条目打开；只在这个上下文第一次打开页面时写，之后的刷新不覆盖页面自己写的 */
  const openWith = (stored: Record<string, string>) =>
    openBrowser({
      stored,
      script: entries => {
        if (sessionStorage.getItem('seeded')) return;
        sessionStorage.setItem('seeded', '1');
        for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
      },
    });

  const followButton = (page: Page) => page.locator('[data-follow-button]');
  const pressed = (page: Page) => followButton(page).getAttribute('aria-pressed');
  /** 浏览器接管页面之后按钮才点得动：等 Nuxt 挂载完 */
  async function goto(page: Page, path: string) {
    await page.goto(url(path), { waitUntil: 'hydration' });
  }
  /** 刷新：重新打开当前地址（整页重新加载，关注项只能从 localStorage 读回来） */
  const reload = (page: Page) => goto(page, new URL(page.url()).pathname);
  /** Following 页上各块：[标题, 有没有 new 标记, 命中的关注项] */
  async function listed(page: Page) {
    await page.waitForSelector('[data-test=block], [data-test=empty], [data-test=no-blocks]');
    return page.locator('[data-test=block]').evaluateAll(blocks =>
      blocks.map(b => [
        b.querySelector('h3')!.textContent!.trim(),
        b.querySelector('[data-test=new]') !== null,
        [...b.querySelectorAll('[data-test=match]')].map(m => m.textContent!.replace(/\s+/g, ' ').trim()),
      ])
    );
  }
  const followedNames = (page: Page) => page.locator('[data-test=follow] a').allInnerTexts();

  it('国家页上关注、刷新后仍在；Following 页列出落点在该国与涉及该国的块，后者标 Involves；取消后回到空状态', async () => {
    const page = await openBrowser();
    await goto(page, '/countries/IL');
    expect(await pressed(page)).toBe('false');
    expect(await followButton(page).innerText()).toBe('Follow');

    await followButton(page).click();
    expect(await pressed(page)).toBe('true');
    expect(await followButton(page).innerText()).toBe('Following');

    await reload(page);
    await page.waitForSelector('[data-follow-button][aria-pressed=true]');
    // 别的国家没被关注
    await goto(page, '/countries/JP');
    expect(await pressed(page)).toBe('false');

    await goto(page, '/following');
    expect(await listed(page)).toEqual([
      ['gaza ceasefire holds', false, ['Israel']],
      ['hostage deal', false, ['Israel']],
      ['iran sanctions', false, ['Involves Israel']],
      ['gaza talks in cairo', false, ['Israel']],
    ]);
    expect(await followedNames(page)).toEqual(['Israel']);
    expect(await page.locator('[data-test=summary]').innerText()).toBe('4 stories');
    expect(await page.locator('[data-test=block] a[href="/briefs/7#story-2"]').count()).toBe(1);

    await page.click('button[aria-label="Stop following Israel"]');
    await page.waitForSelector('[data-test=empty]');
    expect(await listed(page)).toEqual([]);
    // 取消也是持久的：刷新后仍是空状态，国家页上的按钮回到未关注
    await reload(page);
    await page.waitForSelector('[data-test=empty]');
    await goto(page, '/countries/IL');
    expect(await pressed(page)).toBe('false');
    expect(unexpected).toEqual([]);
  });

  it('线索页上关注；Following 页把国家与线索的块并在一起，一块命中两个关注项时都写出；在线索页上再点一次取消', async () => {
    const page = await openWith({ [FOLLOWS_KEY]: IL });
    await goto(page, '/stories/2');
    expect(await pressed(page)).toBe('false');
    await followButton(page).click();
    expect(await pressed(page)).toBe('true');

    await goto(page, '/following');
    expect(await listed(page)).toEqual([
      ['gaza ceasefire holds', false, ['Israel']],
      ['hostage deal', false, ['Israel']],
      ['iran sanctions', false, ['Involves Israel', 'Iran — new sanctions']],
      ['gaza talks in cairo', false, ['Israel']],
    ]);
    expect(await followedNames(page)).toEqual(['Israel', 'Iran — new sanctions']);
    expect(await page.locator('[data-test=follow] a').evaluateAll(links => links.map(a => a.getAttribute('href')))).toEqual([
      '/countries/IL',
      '/stories/2',
    ]);

    await goto(page, '/stories/2');
    await page.waitForSelector('[data-follow-button][aria-pressed=true]');
    await followButton(page).click();
    expect(await pressed(page)).toBe('false');
    await goto(page, '/following');
    expect(await followedNames(page)).toEqual(['Israel']);
    expect(unexpected).toEqual([]);
  });

  it('实体页上关注、刷新后仍在；Following 页列出挂着它的块，命中的实体带实体页链接、不在块下再列一遍；取消后回到空状态', async () => {
    const page = await openBrowser();
    await goto(page, '/entities?name=benjamin%20netanyahu');
    expect(await pressed(page)).toBe('false');
    await followButton(page).click();
    expect(await pressed(page)).toBe('true');

    await page.goto(url('/entities?name=benjamin%20netanyahu'), { waitUntil: 'hydration' });
    await page.waitForSelector('[data-follow-button][aria-pressed=true]');

    await goto(page, '/following');
    expect(await listed(page)).toEqual([
      ['gaza ceasefire holds', false, ['Benjamin Netanyahu']],
      ['fed holds rates', false, ['Benjamin Netanyahu']],
      ['hostage deal', false, ['Benjamin Netanyahu']],
      ['iran sanctions', false, ['Benjamin Netanyahu']],
      ['gaza talks in cairo', false, ['Benjamin Netanyahu']],
    ]);
    expect(await followedNames(page)).toEqual(['Benjamin Netanyahu']);
    expect(await page.locator('[data-test=follow] a').getAttribute('href')).toBe('/entities?name=benjamin%20netanyahu');
    expect(await page.locator('[data-test=match] a[href="/entities?name=benjamin%20netanyahu"]').count()).toBe(5);
    expect(await page.locator('[data-test=block] [data-test=entity]').count()).toBe(0);

    await page.click('button[aria-label="Stop following Benjamin Netanyahu"]');
    await page.waitForSelector('[data-test=empty]');
    await page.goto(url('/entities?name=benjamin%20netanyahu'), { waitUntil: 'hydration' });
    expect(await pressed(page)).toBe('false');
    expect(unexpected).toEqual([]);
  });

  it('实体与国家一起关注：块并在一起，命中两个关注项时都写出', async () => {
    const page = await openWith({
      [FOLLOWS_KEY]: JSON.stringify([{ kind: 'country', code: 'IL' }, { kind: 'entity', key: 'benjamin netanyahu', name: 'Benjamin Netanyahu' }]),
    });
    await goto(page, '/following');
    expect(await listed(page)).toEqual([
      ['gaza ceasefire holds', false, ['Israel', 'Benjamin Netanyahu']],
      ['fed holds rates', false, ['Benjamin Netanyahu']],
      ['hostage deal', false, ['Israel', 'Benjamin Netanyahu']],
      ['iran sanctions', false, ['Involves Israel', 'Benjamin Netanyahu']],
      ['gaza talks in cairo', false, ['Israel', 'Benjamin Netanyahu']],
    ]);
    expect(await followedNames(page)).toEqual(['Israel', 'Benjamin Netanyahu']);
    expect(unexpected).toEqual([]);
  });

  it('关注了、但还没有任何块：写明还没有，不是「没有关注项」的空状态', async () => {
    const page = await openWith({ [FOLLOWS_KEY]: JSON.stringify([{ kind: 'country', code: 'JP' }]) });
    await goto(page, '/following');
    expect(await listed(page)).toEqual([]);
    expect(await page.locator('[data-test=no-blocks]').innerText()).toBe('No stories yet about what you follow.');
    expect(await followedNames(page)).toEqual(['Japan']);
    expect(unexpected).toEqual([]);
  });

  describe('new 标记：所属那一期生成于上次访问之后的块', () => {
    const newTitles = async (page: Page) => (await listed(page)).filter(([, isNew]) => isNew).map(([title]) => title);

    it('第一次来（没有上次访问）：都不标；这次访问被记下', async () => {
      const page = await openWith({ [FOLLOWS_KEY]: IL });
      const before = Date.now();
      await goto(page, '/following');
      expect(await newTitles(page)).toEqual([]);
      const saved = Date.parse((await page.evaluate(key => localStorage.getItem(key), LAST_VISIT_KEY)) ?? '');
      expect(saved).toBeGreaterThanOrEqual(before);
      expect(saved).toBeLessThanOrEqual(Date.now());
    });

    it('上次访问恰好等于一期的生成时刻：那一期不算新，只有更晚的那期标 new', async () => {
      const page = await openWith({ [FOLLOWS_KEY]: IL, [LAST_VISIT_KEY]: '2026-01-09T12:00:00.000Z' });
      await goto(page, '/following');
      expect(await newTitles(page)).toEqual(['gaza ceasefire holds']);
      expect(await page.locator('[data-test=summary]').innerText()).toBe('4 stories · 1 new since your last visit');
    });

    it('上次访问早一毫秒：那一期的两块也标 new；更早的一期不标', async () => {
      const page = await openWith({ [FOLLOWS_KEY]: IL, [LAST_VISIT_KEY]: '2026-01-09T11:59:59.999Z' });
      await goto(page, '/following');
      expect(await newTitles(page)).toEqual(['gaza ceasefire holds', 'hostage deal', 'iran sanctions']);
    });

    it('上次访问晚于所有的期：都不标', async () => {
      const page = await openWith({ [FOLLOWS_KEY]: IL, [LAST_VISIT_KEY]: '2026-01-10T12:00:00.000Z' });
      await goto(page, '/following');
      expect(await newTitles(page)).toEqual([]);
    });

    it('标过的在刷新后不再标（刷新就是又一次访问）；在页面上取消一个关注项不影响已标的', async () => {
      const page = await openWith({
        [FOLLOWS_KEY]: JSON.stringify([{ kind: 'country', code: 'IL' }, { kind: 'thread', id: 2, title: 'Iran' }]),
        [LAST_VISIT_KEY]: '2026-01-09T12:00:00.000Z',
      });
      await goto(page, '/following');
      expect(await newTitles(page)).toEqual(['gaza ceasefire holds']);
      await page.click('button[aria-label="Stop following Iran — new sanctions"]');
      await page.waitForFunction(() => document.querySelectorAll('[data-test=follow]').length === 1);
      expect(await newTitles(page)).toEqual(['gaza ceasefire holds']);

      await reload(page);
      expect((await listed(page)).length).toBe(4);
      expect(await newTitles(page)).toEqual([]);
    });

    it('取数失败的那次不算访问：读者什么块都没看到，修好后再来，之前没看过的仍标 new', async () => {
      const path = '/reader/following?countries=IL&threads=&limit=20&offset=0';
      const saved = replies.get(path)!;
      const page = await openWith({ [FOLLOWS_KEY]: IL, [LAST_VISIT_KEY]: '2026-01-09T12:00:00.000Z' });
      replies.set(path, { status: 500, body: '{"error":"boom"}' });
      try {
        await goto(page, '/following');
        await page.waitForSelector('text=Could not load your stories right now');
      } finally {
        replies.set(path, saved);
      }
      await reload(page);
      expect(await newTitles(page)).toEqual(['gaza ceasefire holds']);
    });

    it('存着的上次访问不是时间：按第一次来算', async () => {
      const page = await openWith({ [FOLLOWS_KEY]: IL, [LAST_VISIT_KEY]: 'not-a-date' });
      await goto(page, '/following');
      expect(await newTitles(page)).toEqual([]);
    });
  });

  describe('localStorage 用不了', () => {
    // 本站自己的条目（meridian-*）读写都抛——浏览器禁用站点数据、隐私模式写满配额时 localStorage 的表现。
    // 别的 key 放行：两个第三方模块（@nuxtjs/color-mode 3.5.2、nuxt-auth-utils 0.5.20）在浏览器里读 localStorage 没有保护，
    // 它们一抛整个站点都起不来，那是关注功能之前就有的问题，不在这里测
    const openWithoutStorage = () =>
      openBrowser({
        script: () => {
          for (const method of ['getItem', 'setItem'] as const) {
            const original = Storage.prototype[method];
            Storage.prototype[method] = function (this: Storage, key: string, ...rest: string[]) {
              if (this === window.localStorage && key.startsWith('meridian-')) throw new DOMException('denied', 'SecurityError');
              return (original as (...args: string[]) => unknown).call(this, key, ...rest);
            } as never;
          }
        },
      });

    it('国家页、线索页、Following 页照常渲染；关注在这次会话里生效，只是不持久', async () => {
      const page = await openWithoutStorage();
      const errors: string[] = [];
      page.on('pageerror', err => errors.push(String(err)));

      await goto(page, '/stories/1');
      expect(await page.locator('h1').innerText()).toBe('Gaza — ceasefire holds');
      await goto(page, '/following');
      await page.waitForSelector('[data-test=empty]');

      await goto(page, '/countries/IL');
      expect(await page.locator('[data-section=placement] h3').count()).toBe(3);
      await followButton(page).click();
      expect(await pressed(page)).toBe('true');
      // 站内跳转（不重新加载页面）：这次会话里的关注项还在
      await page.click('a[href="/following"]');
      expect((await listed(page)).map(([title]) => title)).toEqual(['gaza ceasefire holds', 'hostage deal', 'iran sanctions', 'gaza talks in cairo']);

      await reload(page);
      await page.waitForSelector('[data-test=empty]');
      expect(errors).toEqual([]);
      expect(unexpected).toEqual([]);
    });

    it('存着的关注项不是合法的 JSON、或条目形状不对：按没有那些关注项算，页面照常', async () => {
      const broken = await openWith({ [FOLLOWS_KEY]: '{oops' });
      await goto(broken, '/following');
      await broken.waitForSelector('[data-test=empty]');

      const mixed = await openWith({
        [FOLLOWS_KEY]: JSON.stringify([{ kind: 'topic', key: 'economy' }, null, { kind: 'country', code: 'il' }, { kind: 'entity', key: 'Hamas' }, { kind: 'entity', key: '' }, { kind: 'thread', id: 1, title: 'Gaza' }, { kind: 'thread', id: 1 }]),
      });
      await goto(mixed, '/following');
      expect((await listed(mixed)).map(([title]) => title)).toEqual(['gaza ceasefire holds', 'hostage deal', 'gaza talks in cairo']);
      expect(await followedNames(mixed)).toEqual(['Gaza — ceasefire holds']);
      expect(unexpected).toEqual([]);
    });
  });

  it('服务端渲染出的 Following 页只有外壳（关注项只在浏览器里），不去问 backend；导航栏有 Following 入口', async () => {
    const res = await fetch('/following');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toMatch(/<h1\b[^>]*>\s*Following\s*<\/h1>/);
    for (const path of ['/following', '/stories', '/search', '/']) {
      expect(await (await fetch(path)).text(), path).toMatch(/<a\b[^>]*href="\/following"/);
    }
    expect(unexpected).toEqual([]);
  });
});

// ── 实体页：期望值写死自 backend 的 entity-* 与 block-entities-all 快照 ──────────
describe('实体页（SSR）', () => {
  const text = (inner: string) => inner.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  /** 各块：[标题, 「读这一块」链接, 块下的实体链接] */
  const blocksOf = (html: string) =>
    [...html.matchAll(/<article\b[^>]*data-test="block"[^>]*>([\s\S]*?)<\/article>/g)].map(([, article]) => [
      text(/<h3\b[^>]*>([\s\S]*?)<\/h3>/.exec(article)![1]),
      /href="(\/briefs\/[^"]*)"/.exec(article)![1],
      [...article.matchAll(/data-test="entity"[^>]*>\s*<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(([, href, name]) => [text(name), href]),
    ]);

  it('过门槛的实体：名字用最常见的写法，它的块按期倒序；本页的实体不在块下再列一遍；未发布那期的块不出现', async () => {
    const res = await fetch('/entities?name=Benjamin%20Netanyahu');
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toMatch(/<h1\b[^>]*>\s*Benjamin Netanyahu\s*<\/h1>/);
    expect(blocksOf(html)).toEqual([
      ['gaza ceasefire holds', '/briefs/8#story-1', []],
      ['fed holds rates', '/briefs/8#story-2', []],
      ['hostage deal', '/briefs/7#story-1', []],
      ['iran sanctions', '/briefs/7#story-2', []],
      ['gaza talks in cairo', '/briefs/6#story-1', []],
    ]);
    expect(text(html)).toContain('5 stories where most of the coverage mentions Benjamin Netanyahu');
    expect(html).toContain('data-follow-button');
    expect(html).not.toContain('ukraine debug');
    expect(unexpected).toEqual([]);
  });

  it('能归成国家的写法：跳到国家页', async () => {
    const res = await fetch('/entities?name=Iran', { redirect: 'manual' });
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/countries/IR');
    expect(unexpected).toEqual([]);
  });

  it('没过门槛的实体、超过 200 字的写法：404', async () => {
    for (const path of ['/entities?name=hamas', `/entities?name=${'a'.repeat(201)}`]) {
      expect((await fetch(path)).status, path).toBe(404);
    }
    expect(unexpected).toEqual([]);
  });

  it('国家页、搜索页的块下有实体链接，指向实体页', async () => {
    for (const path of ['/countries/IL', '/search?q=gaza']) {
      const html = await (await fetch(path)).text();
      expect(html, path).toMatch(/data-test="entity"[^>]*>\s*<a\b[^>]*href="\/entities\?name=benjamin%20netanyahu"[^>]*>\s*Benjamin Netanyahu\s*<\/a>/);
    }
    expect(unexpected).toEqual([]);
  });
});

// ── 实体的入口：列表页、阅读页每块下的链接、导航 ──────────
describe('实体的入口（SSR）', () => {
  const text = (inner: string) => inner.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  /** 阅读页各条目：[锚点 id, 条目下的实体链接] */
  const storiesOf = (html: string) =>
    [...html.matchAll(/<article\b[^>]*\bid="(story-\d+)"[^>]*>([\s\S]*?)<\/article>/g)].map(([, id, article]) => [
      id,
      [...article.matchAll(/data-test="entity"[^>]*>\s*<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(([, href, name]) => [text(name), href]),
    ]);

  it('列表页（不带写法、空写法都是它）：有实体页的实体，带块数，链到各自的页', async () => {
    for (const path of ['/entities', '/entities?name=%20']) {
      const res = await fetch(path);
      expect(res.status, path).toBe(200);
      const html = await res.text();
      expect(html).toMatch(/<h1\b[^>]*>\s*Names in the news\s*<\/h1>/);
      const rows = [...html.matchAll(/data-test="entity-row"[^>]*>\s*<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)].map(([, href, inner]) => [href, text(inner)]);
      expect(rows, path).toEqual([['/entities?name=benjamin%20netanyahu', 'Benjamin Netanyahu 5 stories']]);
    }
    expect(unexpected).toEqual([]);
  });

  it('阅读页：每个条目下列出它的实体，链到实体页', async () => {
    const res = await fetch('/briefs/8');
    expect(res.status).toBe(200);
    const netanyahu = [['Benjamin Netanyahu', '/entities?name=benjamin%20netanyahu']];
    expect(storiesOf(await res.text())).toEqual([['story-1', netanyahu], ['story-2', netanyahu]]);
    expect(unexpected).toEqual([]);
  });

  it('阅读页：实体取不到时正文照常，只是没有实体链接', async () => {
    const saved = replies.get('/reader/briefs/8/block-entities')!;
    replies.set('/reader/briefs/8/block-entities', { status: 500, body: '{"error":"boom"}' });
    try {
      const res = await fetch('/briefs/8');
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain('gaza ceasefire holds');
      expect(storiesOf(html)).toEqual([['story-1', []], ['story-2', []]]);
    } finally {
      replies.set('/reader/briefs/8/block-entities', saved);
    }
  });

  it('导航与搜索页上有进列表页的入口；实体页能回列表页', async () => {
    for (const path of ['/', '/briefs', '/search', '/entities?name=benjamin%20netanyahu']) {
      expect(await (await fetch(path)).text(), path).toMatch(/<a\b[^>]*href="\/entities"/);
    }
  });
});

describe('backend 故障', () => {
  it('backend 回 5xx：前端回 502', async () => {
    replies.set('/reader/stories', { status: 500, body: '{"error":"boom"}' });
    expect((await fetch('/api/stories')).status).toBe(502);
  });
});
