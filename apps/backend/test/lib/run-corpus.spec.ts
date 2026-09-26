import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import {
  bodyFingerprint,
  checkQuality,
  dropSameSourceDuplicates,
  fetchBody,
  loadRunEmbeddings,
} from '../../src/lib/core/run-corpus';

// 一期输入 module：质量门 / 同源去重 / 取正文 / embeddings 读回。
// R2 用 workers pool 的真 bucket binding（wrangler.test.jsonc 的 ARTICLES_BUCKET，本地模拟桶）。

const OK_META = { title: 'Title', content_quality: null, completeness: null };
const BODY = 'A real article body that is clearly longer than twice the title.';

// Cloudflare 人机验证页（与 extraction-quality.spec.ts 同源），looksLikeExtractionFailure 判 block_page
const CF_CHALLENGE =
  "www.politico.comPerforming security verificationThis website uses a security service to protect against malicious bots. This page is displayed while the website verifies you are not a bot.Incompatible browser extension or network configurationYour browser extensions or network settings have blocked the security verification process required by www.politico.com. To resolve this, try the following steps:Temporarily disable browser extensions:Go to your browser settings.Locate your browser extensions and temporarily disable them.Once browser extensions are disabled, refresh this page.Check your network settings:Verify if your internet or firewall settings have blocked your device from reaching “challenges.cloudflare.com”. You may need to consult your operating system's help documentation or your network administrator for guidance on adjusting firewall settings.If you do not have permission to adjust network settings, try connecting to a different network.If these steps do not resolve the issue, refer to Cloudflare's troubleshooting documentation for more help. For detailed guidance on how to disable your browser extensions or check your network settings, refer to your browser or device’s documentation.";

describe('checkQuality（质量门）', () => {
  it('通过', () => {
    expect(checkQuality(BODY, OK_META)).toEqual({ isValid: true });
  });
  it.each([
    ['空串', '', OK_META, 'EMPTY_CONTENT'],
    ['纯空白', '   \n ', OK_META, 'EMPTY_CONTENT'],
    ['短于标题两倍', 'Short', { ...OK_META, title: 'A fairly long title' }, 'INSUFFICIENT_LENGTH'],
    ['只有标题（带空白凑够长度）', 'ab  ', { ...OK_META, title: 'ab' }, 'TITLE_ONLY'],
    ['抓取失败签名', CF_CHALLENGE, OK_META, 'EXTRACTION_JUNK_block_page'],
    ['LOW_QUALITY', BODY, { ...OK_META, content_quality: 'LOW_QUALITY' }, 'MARKED_LOW_QUALITY'],
    ['JUNK', BODY, { ...OK_META, content_quality: 'JUNK' }, 'MARKED_LOW_QUALITY'],
    ['PARTIAL_USELESS', BODY, { ...OK_META, completeness: 'PARTIAL_USELESS' }, 'MARKED_INCOMPLETE'],
  ])('%s → %s', (_name, content, meta, reason) => {
    expect(checkQuality(content, meta)).toEqual({ isValid: false, reason });
  });
  it('PARTIAL_USEFUL / OK 标记不拦', () => {
    expect(checkQuality(BODY, { ...OK_META, content_quality: 'OK', completeness: 'PARTIAL_USEFUL' })).toEqual({ isValid: true });
  });
});

describe('bodyFingerprint', () => {
  it('多行：去掉首行，空白折叠、大小写不敏感', async () => {
    const a = await bodyFingerprint('Updated: 19/09/2026 - 7:00\nSame   Body\ntext');
    const b = await bodyFingerprint('Updated: 20/09/2026 - 9:00\nsame body TEXT');
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(a).toBe(b);
  });
  it('单行：用全文，不去首行（不同正文不同指纹）', async () => {
    const a = await bodyFingerprint('only one line A');
    const b = await bodyFingerprint('only one line B');
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(a).not.toBe(b);
    expect(await bodyFingerprint('Only One  Line A ')).toBe(a);
  });
  it('空 / 去首行后为空 → null', async () => {
    expect(await bodyFingerprint('')).toBeNull();
    expect(await bodyFingerprint('timestamp\n   \n')).toBeNull();
  });
});

describe('dropSameSourceDuplicates', () => {
  const item = (id: number, dedupKey: string | null) => ({
    article: { id, title: `t${id}` },
    embedding: { articleId: id, embedding: [id] },
    dedupKey,
  });

  it('同键只留 id 最小者，article/embedding 保持成对，其余顺序不变', () => {
    const items = [item(5, 'k'), item(9, null), item(3, 'k'), item(8, 'other'), item(7, 'k'), item(2, null)];
    const { kept, dropped } = dropSameSourceDuplicates(items);
    expect(kept.map(i => i.article.id)).toEqual([9, 3, 8, 2]);
    expect(dropped.map(i => i.article.id)).toEqual([5, 7]);
    for (const i of [...kept, ...dropped]) expect(i.embedding.articleId).toBe(i.article.id);
  });

  it('null 键不参与去重', () => {
    const items = [item(1, null), item(2, null)];
    expect(dropSameSourceDuplicates(items)).toEqual({ kept: items, dropped: [] });
  });
});

describe('fetchBody', () => {
  const bucket = env.ARTICLES_BUCKET;

  it('无 key → MISSING_CONTENT_KEY', async () => {
    expect(await fetchBody(bucket, null)).toEqual({ status: 'MISSING_CONTENT_KEY', content: '' });
  });
  it('对象不存在 → R2_CONTENT_MISSING', async () => {
    expect(await fetchBody(bucket, 'run-corpus-test/missing.txt')).toEqual({ status: 'R2_CONTENT_MISSING', content: '' });
  });
  it('空串与纯空白 → EMPTY_R2_CONTENT', async () => {
    await bucket.put('run-corpus-test/empty.txt', '');
    await bucket.put('run-corpus-test/blank.txt', '  \n\t ');
    expect(await fetchBody(bucket, 'run-corpus-test/empty.txt')).toEqual({ status: 'EMPTY_R2_CONTENT', content: '' });
    expect(await fetchBody(bucket, 'run-corpus-test/blank.txt')).toEqual({ status: 'EMPTY_R2_CONTENT', content: '' });
  });
  it('有正文 → OK，原样返回', async () => {
    await bucket.put('run-corpus-test/ok.txt', ' body\n');
    expect(await fetchBody(bucket, 'run-corpus-test/ok.txt')).toEqual({ status: 'OK', content: ' body\n' });
  });
  it('读取抛错 → R2_FETCH_ERROR，带出 error', async () => {
    // R2 key 上限 1024 字节，超长 key 让真 binding 抛错
    const r = await fetchBody(bucket, 'x'.repeat(2000));
    expect(r.status).toBe('R2_FETCH_ERROR');
    expect(r.content).toBe('');
    expect(r.error).toBeDefined();
  });
});

describe('loadRunEmbeddings', () => {
  it('读回写入的 embeddings', async () => {
    const data = [{ articleId: 1, embedding: [0.1, 0.2] }];
    await env.ARTICLES_BUCKET.put('datasets/run-corpus-test/embeddings.json', JSON.stringify(data));
    expect(await loadRunEmbeddings(env.ARTICLES_BUCKET, 'datasets/run-corpus-test/embeddings.json')).toEqual(data);
  });
  it('对象不存在 → 抛错且错误信息带 key（不再静默成 []）', async () => {
    await expect(loadRunEmbeddings(env.ARTICLES_BUCKET, 'datasets/nope/embeddings.json')).rejects.toThrow(
      'datasets/nope/embeddings.json'
    );
  });
});
