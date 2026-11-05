/**
 * 简报邮件：`POST /admin/briefs/:id/email`（补发入口），走真实路由 + 本机测试库。
 * 邮件 binding 是外部服务：`env.EMAIL` 换成记录 send() 调用的假实现（同 admin-run-scheduled.spec.ts 换 AUTO_BRIEF）。
 * 收件人 BRIEF_EMAIL_TO、发件人 BRIEF_EMAIL_FROM、读者站 READER_BASE_URL 按用例设置。
 *
 * 最后一组经 saveBriefReport 存一期再补发：定时（cron）跑出的期会寄、手动触发的调试期不寄——
 * workflow 在「保存简报」之后调的就是同一个发送函数，发不发只看这一期有没有发布。
 */
import { $brief_runs, $reports, sql } from '@meridian/database';
import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../../src/lib/database';
import { saveBriefReport } from '../../src/lib/save-brief-report';

if (!env.BACKEND_TEST_DB) {
  throw new Error('缺 BACKEND_TEST_DATABASE_URL（本机测试库，见 apps/backend/test/README.md「数据库」）');
}

const db = getDb(env.HYPERDRIVE);

type Sent = {
  from: string | { name: string; email: string };
  to: string | (string | { name: string; email: string })[];
  subject: string;
  html?: string;
  text?: string;
};

const mutableEnv = env as unknown as {
  EMAIL: unknown;
  BRIEF_EMAIL_TO?: string;
  BRIEF_EMAIL_FROM?: string;
  READER_BASE_URL?: string;
};
const saved = { ...mutableEnv };

let sent: Sent[] = [];
let sendError: Error | null = null;

const resend = (id: number | string, auth: string | null = `Bearer ${env.API_TOKEN}`) =>
  exports.default.fetch(`http://backend/admin/briefs/${id}/email`, {
    method: 'POST',
    headers: auth === null ? {} : { Authorization: auth },
  });

const BRIEF = {
  title: 'Ports & power: a ceasefire holds',
  tldr: 'The ceasefire held for a third day while shipping resumed through the strait.',
  blocks: [
    { title: 'Ceasefire holds in the north', body: 'Both sides reported no shelling overnight, according to **Reuters** and local officials.\n\nTalks resume on Monday in Geneva.' },
    { title: 'Shipping resumes through the strait', body: 'Insurers cut war-risk premiums after the first convoy passed safely.' },
    { title: 'Central bank holds rates', body: 'The bank kept its policy rate at four percent and signalled patience.' },
  ],
};
const CONTENT = [
  '## top stories',
  '',
  `<u>**${BRIEF.blocks[0].title}**</u>`,
  BRIEF.blocks[0].body,
  '',
  `<u>**${BRIEF.blocks[1].title}**</u>`,
  BRIEF.blocks[1].body,
  '',
  '## more news',
  '',
  `<u>**${BRIEF.blocks[2].title}**</u>`,
  BRIEF.blocks[2].body,
].join('\n');

// 北京时间 2026-11-06 01:00（UTC 还是 11-05）：主题里的日期按北京时间
const CREATED_AT = new Date('2026-11-05T17:00:00Z');

async function insertReport(published: boolean): Promise<number> {
  const [row] = await db
    .insert($reports)
    .values({
      title: BRIEF.title,
      content: CONTENT,
      tldr_prose: BRIEF.tldr,
      usedArticles: 12,
      usedSources: 5,
      published_at: published ? new Date('2026-11-05T17:05:00Z') : null,
      createdAt: CREATED_AT,
    })
    .returning({ id: $reports.id });
  return row.id;
}

/** HTML → 读得到的文字：去标签、解实体、并空白。只用来断言「读者读得到这句话」 */
function visibleText(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/\s+/g, ' ');
}

/** 每一段依次出现在 text 里（按阅读顺序） */
function expectInOrder(text: string, parts: string[]) {
  let from = 0;
  for (const part of parts) {
    const at = text.indexOf(part, from);
    expect(at, `「${part}」应在 ${from} 之后出现`).toBeGreaterThanOrEqual(0);
    from = at + part.length;
  }
}

const READING_ORDER = [
  BRIEF.title,
  BRIEF.tldr,
  BRIEF.blocks[0].title,
  'Both sides reported no shelling overnight, according to',
  'Talks resume on Monday in Geneva.',
  BRIEF.blocks[1].title,
  BRIEF.blocks[1].body,
  BRIEF.blocks[2].title,
  BRIEF.blocks[2].body,
];

const recipients = (m: Sent) => (Array.isArray(m.to) ? m.to : [m.to]).map(r => (typeof r === 'string' ? r : r.email));
const senderEmail = (m: Sent) => (typeof m.from === 'string' ? m.from : m.from.email);

beforeEach(async () => {
  sent = [];
  sendError = null;
  mutableEnv.EMAIL = {
    send: async (message: Sent) => {
      sent.push(message);
      if (sendError) throw sendError;
      return { messageId: `fake-${sent.length}` };
    },
  };
  mutableEnv.BRIEF_EMAIL_TO = 'owner@example.com, second@example.com';
  mutableEnv.BRIEF_EMAIL_FROM = 'brief@pathsoflight.test';
  mutableEnv.READER_BASE_URL = 'https://reader.test';
  await db.execute(sql`truncate reports, brief_runs restart identity cascade`);
});

afterEach(() => {
  Object.assign(mutableEnv, saved);
  for (const key of ['BRIEF_EMAIL_TO', 'BRIEF_EMAIL_FROM', 'READER_BASE_URL'] as const) {
    if (!(key in saved)) delete mutableEnv[key];
  }
});

describe('POST /admin/briefs/:id/email', () => {
  it('已发布的一期：寄出恰好一封，发给配置的收件人、来自配置的发件人', async () => {
    const id = await insertReport(true);
    const res = await resend(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { status: 'sent' } });
    expect(sent).toHaveLength(1);
    expect(recipients(sent[0]).sort()).toEqual(['owner@example.com', 'second@example.com']);
    expect(senderEmail(sent[0])).toBe('brief@pathsoflight.test');
  });

  it('主题含北京时间的日期与本期标题；HTML 与纯文本都按阅读顺序含标题、摘要、每块标题与正文、回站链接', async () => {
    const id = await insertReport(true);
    await resend(id);
    const [message] = sent;

    expect(message.subject).toContain(BRIEF.title);
    expect(message.subject).toMatch(/November 6, 2026|Nov 6, 2026|2026-11-06/);

    const link = `https://reader.test/briefs/${id}`;
    expect(message.html).toBeTypeOf('string');
    expect(message.text).toBeTypeOf('string');
    expectInOrder(visibleText(message.html!), READING_ORDER);
    expect(message.html).toContain(`href="${link}"`);
    expectInOrder(message.text!.replace(/\s+/g, ' ').replace(/\*\*/g, ''), READING_ORDER);
    expect(message.text).toContain(link);
  });

  it('HTML 只用行内样式：没有 <script>、外链样式表、<style> 块', async () => {
    const id = await insertReport(true);
    await resend(id);
    const html = sent[0].html!;
    expect(html).not.toMatch(/<script\b/i);
    expect(html).not.toMatch(/<link\b[^>]*stylesheet/i);
    expect(html).not.toMatch(/<style\b/i);
  });

  it('每个 style 属性都完整：值里没有把属性提前截断的双引号', async () => {
    const id = await insertReport(true);
    await resend(id);
    const attrs = [...sent[0].html!.matchAll(/style="[^"]*"(.)/g)];
    expect(attrs.length).toBeGreaterThan(0);
    for (const [attr, next] of attrs) expect(next, attr).toMatch(/[\s>/]/);
  });

  it('没发布的一期（published_at 为空）：404，不寄', async () => {
    const id = await insertReport(false);
    expect((await resend(id)).status).toBe(404);
    expect(sent).toHaveLength(0);
  });

  it('不存在的期号：404，不寄', async () => {
    await insertReport(true);
    expect((await resend(999999)).status).toBe(404);
    expect(sent).toHaveLength(0);
  });

  it('没配收件人：不寄，响应写明 skipped', async () => {
    delete mutableEnv.BRIEF_EMAIL_TO;
    const id = await insertReport(true);
    const res = await resend(id);
    expect(res.status).toBeLessThan(300);
    expect(await res.json()).toMatchObject({ data: { status: 'skipped' } });
    expect(sent).toHaveLength(0);
  });

  it('收件人配成空串：同样 skipped', async () => {
    mutableEnv.BRIEF_EMAIL_TO = ' , ';
    const id = await insertReport(true);
    const res = await resend(id);
    expect(await res.json()).toMatchObject({ data: { status: 'skipped' } });
    expect(sent).toHaveLength(0);
  });

  it('binding 抛错：非 2xx、带上原因；只试一次，不在背后重试', async () => {
    sendError = new Error('destination address not verified');
    const id = await insertReport(true);
    const res = await resend(id);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(await res.json())).toContain('destination address not verified');
    expect(sent).toHaveLength(1);
  });

  it('不带 token：401，不寄', async () => {
    const id = await insertReport(true);
    expect((await resend(id, null)).status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  it('token 错：401，不寄', async () => {
    const id = await insertReport(true);
    expect((await resend(id, 'Bearer wrong-token')).status).toBe(401);
    expect(sent).toHaveLength(0);
  });
});

describe('只寄定时（cron）跑出的期', () => {
  async function saveRun(workflowId: string, triggeredBy: string): Promise<number> {
    await db.insert($brief_runs).values({ workflow_id: workflowId, status: 'RUNNING', params: { triggeredBy } });
    return saveBriefReport(
      db,
      workflowId,
      { title: BRIEF.title, content: CONTENT, tldr_prose: BRIEF.tldr, usedArticles: 12, usedSources: 5 },
      []
    );
  }

  it('cron 跑出的期：寄', async () => {
    const id = await saveRun('cron-brief-1', 'cron');
    expect((await resend(id)).status).toBe(200);
    expect(sent).toHaveLength(1);
  });

  it('手动触发的调试期：不寄', async () => {
    const id = await saveRun('manual-brief-1', 'manual');
    expect((await resend(id)).status).toBe(404);
    expect(sent).toHaveLength(0);
  });
});
