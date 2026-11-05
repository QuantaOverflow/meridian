// 简报邮件：一期已发布的简报寄给站主（只有站主，不是订阅）。
//
// 两个入口共用 sendBriefEmail：
//   - workflow 在「保存简报」之后调一次（只有 cron 跑出的期有 published_at，手动调试期在这里就是 not_found，不寄）；
//   - 补发路由 POST /admin/briefs/:id/email（routers/admin.ts）。
// 只试一次：失败不重试、不抛给调用方，交回 failed 与原因，由调用方记 error 日志或回非 2xx。
//
// 内容与读者站的简报页同一份、同一顺序：标题、摘要，然后 reports.content 里的每个板块与每一块。
// 取 reports.content 而不取 brief_blocks：对不上故事的块读者页上有、brief_blocks 里没有（ADR 0014），
// 而读者页就是解析 reports.content 渲染的（apps/frontend/src/server/lib/briefContent.ts）。
import { $reports, and, eq } from '@meridian/database';
import MarkdownIt from 'markdown-it';
import type { Env } from '../index';
import { isPublished } from './reader/briefs';
import { getDb } from './database';
import { Logger } from './core/logger';

const logger = new Logger({ component: 'brief-email' });

export type BriefEmailResult =
  | { status: 'sent'; reportId: number; recipients: number; messageId: string | null }
  | { status: 'skipped'; reportId: number; reason: string }
  | { status: 'not_found'; reportId: number }
  | { status: 'failed'; reportId: number; error: string };

interface BriefForEmail {
  id: number;
  title: string;
  content: string;
  tldrProse: string | null;
  createdAt: Date;
}

/** BRIEF_EMAIL_TO：逗号分隔，去空白、去空项 */
function recipientsFrom(env: Env): string[] {
  return (env.BRIEF_EMAIL_TO ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(s => s !== '');
}

export async function sendBriefEmail(env: Env, reportId: number): Promise<BriefEmailResult> {
  const log = logger.child({ report_id: reportId });
  // 取数、渲染、发送任何一步抛错（库连不上、Email Service 拒收）都一样：记 error、交回 failed 与原因
  try {
    return await attemptSend(env, reportId, log);
  } catch (err) {
    // Email Service 的错误带 code（如 E_SENDER_NOT_VERIFIED），一并带上
    const code = (err as { code?: unknown })?.code;
    const message = err instanceof Error ? err.message : String(err);
    const error = typeof code === 'string' && code !== '' ? `${code}: ${message}` : message;
    log.error('简报邮件失败', { error_message: error }, err);
    return { status: 'failed', reportId, error };
  }
}

async function attemptSend(env: Env, reportId: number, log: Logger): Promise<BriefEmailResult> {
  const db = getDb(env.HYPERDRIVE);
  const brief = await db.query.$reports.findFirst({
    where: and(eq($reports.id, reportId), isPublished),
    columns: { id: true, title: true, content: true, tldr_prose: true, createdAt: true },
  });
  if (brief === undefined) return { status: 'not_found', reportId };

  const to = recipientsFrom(env);
  if (to.length === 0) {
    log.warn('简报邮件跳过：没配收件人 BRIEF_EMAIL_TO');
    return { status: 'skipped', reportId, reason: 'BRIEF_EMAIL_TO is not set' };
  }
  // 配了收件人却缺发件 binding / 发件人：是配置错了，不是「没开邮件」，按失败报
  if (!env.EMAIL || !env.BRIEF_EMAIL_FROM) {
    throw new Error(`email not configured: ${!env.EMAIL ? 'send_email binding EMAIL' : 'BRIEF_EMAIL_FROM'} is missing`);
  }

  const email = renderBriefEmail(
    { id: brief.id, title: brief.title, content: brief.content, tldrProse: brief.tldr_prose, createdAt: brief.createdAt },
    briefUrl(env, brief.id)
  );
  const result = await env.EMAIL.send({
    from: { name: 'Meridian', email: env.BRIEF_EMAIL_FROM },
    to,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });
  log.info('简报邮件已寄出', { recipients: to.length, message_id: result?.messageId });
  return { status: 'sent', reportId, recipients: to.length, messageId: result?.messageId ?? null };
}

function briefUrl(env: Env, id: number): string {
  return `${(env.READER_BASE_URL ?? 'https://meridian-reader.pages.dev').replace(/\/+$/, '')}/briefs/${id}`;
}

// ===== 渲染 =====

// 选项同读者页（briefContent.ts），只是 html 关掉：模型偶尔漏进正文的 HTML 在邮件里按字面显示，不当标签
const md = new MarkdownIt({ linkify: true, breaks: true, typographer: true, html: false });

// Gmail 不认 <style> 块与外链样式表，样式全写在标签上。字体、字号、行高放在外层 div 上由正文继承，
// 不逐段重复：Gmail 对超过约 102KB 的 HTML 会截断成「显示完整邮件」。
// 属性值用双引号包，样式里的字体名只能用单引号
const STYLE = {
  body: 'margin:0;padding:0;background:#f4f4f1;',
  wrap: "max-width:640px;margin:0 auto;padding:24px 20px;background:#ffffff;font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.6;color:#1a1a1a;",
  date: 'margin:0 0 8px;font-family:Helvetica,Arial,sans-serif;font-size:13px;color:#666666;',
  title: 'margin:0 0 16px;font-size:26px;line-height:1.25;font-weight:bold;',
  tldr: 'margin:0 0 24px;font-size:17px;line-height:1.55;color:#333333;',
  section: 'margin:32px 0 12px;padding-top:12px;border-top:1px solid #dddddd;font-family:Helvetica,Arial,sans-serif;font-size:13px;letter-spacing:1px;text-transform:uppercase;color:#666666;',
  story: 'margin:20px 0 8px;font-size:20px;line-height:1.3;font-weight:bold;',
  p: 'margin:0 0 12px;',
  a: 'color:#1a5fb4;',
  footer: 'margin:32px 0 0;padding-top:16px;border-top:1px solid #dddddd;font-family:Helvetica,Arial,sans-serif;font-size:14px;',
};

// markdown-it 渲染出的块级标签与链接逐个挂上行内样式
const RULE_STYLES = {
  paragraph_open: STYLE.p,
  link_open: STYLE.a,
  bullet_list_open: 'margin:0 0 12px;padding-left:20px;',
  ordered_list_open: 'margin:0 0 12px;padding-left:20px;',
  list_item_open: 'margin:0 0 6px;',
};
for (const [rule, style] of Object.entries(RULE_STYLES)) {
  md.renderer.rules[rule] = (tokens, idx, options, _env, self) => {
    tokens[idx].attrSet('style', style);
    return self.renderToken(tokens, idx, options);
  };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 行内 markdown → 纯文本：链接留文字和地址，粗斜体与行内代码去记号 */
function markdownToText(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1');
}

interface Section {
  heading: string;
  /** 板块下不属于任何块的内容（历史期的清单板块） */
  lead: string;
  stories: { title: string; body: string }[];
}

// 与读者页同一套记号（briefContent.ts）：`## 板块名`、独占一行的 `<u>**块标题**</u>`
const SECTION_RE = /^#{2,4}\s+(.+?)\s*$/;
const STORY_RE = /^\s*<u>(.+?)<\/u>\s*$/;

function parseSections(content: string): Section[] {
  const sections: Section[] = [];
  let section: Section | null = null;
  let story: { title: string; body: string } | null = null;
  let buffer: string[] = [];
  const flush = () => {
    const text = buffer.join('\n').trim();
    buffer = [];
    if (text === '') return;
    if (story !== null) story.body = text;
    else {
      section ??= { heading: '', lead: '', stories: [] };
      if (!sections.includes(section)) sections.push(section);
      section.lead = section.lead === '' ? text : `${section.lead}\n\n${text}`;
    }
  };
  for (const line of stripPromptArtifacts(content).split('\n')) {
    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch !== null) {
      flush();
      story = null;
      section = { heading: sectionMatch[1], lead: '', stories: [] };
      sections.push(section);
      continue;
    }
    const storyMatch = line.match(STORY_RE);
    if (storyMatch !== null) {
      flush();
      if (section === null) {
        section = { heading: '', lead: '', stories: [] };
        sections.push(section);
      }
      story = { title: storyMatch[1].trim().replace(/^\*\*/, '').replace(/\*\*$/, '').trim(), body: '' };
      section.stories.push(story);
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections.filter(s => s.lead !== '' || s.stories.length > 0);
}

/** 读者页对正文做的同一件事（briefContent.ts 的 stripPromptArtifacts）：历史期里漏进正文的 prompt 容器名，换成读者能懂的说法 */
function stripPromptArtifacts(text: string): string {
  return text.replace(/<\/?curated_news_data>/g, 'data').replace(/<\/?final_brief>/g, '');
}

/** 读者页对摘要做的同一件事（briefContent.ts 的 stripInlineMarkdown）：摘要按纯文本显示 */
function stripInlineMarkdown(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1').replace(/`(.+?)`/g, '$1');
}

/** 日期按北京时间：简报北京时间 21:00 出，读者按自己那天认 */
function beijingDate(d: Date): string {
  return d.toLocaleDateString('en-US', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'long', day: 'numeric' });
}

/** 渲染是纯函数，取数与发信在 sendBriefEmail */
function renderBriefEmail(brief: BriefForEmail, url: string): { subject: string; html: string; text: string } {
  const date = beijingDate(brief.createdAt);
  const tldr = brief.tldrProse === null ? null : stripInlineMarkdown(brief.tldrProse).trim();
  const sections = parseSections(brief.content);

  const html: string[] = [
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(brief.title)}</title></head>`,
    `<body style="${STYLE.body}"><div style="${STYLE.wrap}">`,
    `<p style="${STYLE.date}">Meridian · ${escapeHtml(date)}</p>`,
    `<h1 style="${STYLE.title}"><a href="${escapeHtml(url)}" style="color:#1a1a1a;text-decoration:none;">${escapeHtml(brief.title)}</a></h1>`,
  ];
  const text: string[] = [brief.title, `Meridian · ${date}`, ''];
  if (tldr) {
    html.push(`<p style="${STYLE.tldr}">${escapeHtml(tldr)}</p>`);
    text.push(tldr, '');
  }
  for (const section of sections) {
    if (section.heading !== '') {
      html.push(`<h2 style="${STYLE.section}">${md.renderInline(section.heading)}</h2>`);
      text.push('', `== ${markdownToText(section.heading).toUpperCase()} ==`, '');
    }
    if (section.lead !== '') {
      html.push(md.render(section.lead));
      text.push(markdownToText(section.lead), '');
    }
    for (const story of section.stories) {
      html.push(`<h3 style="${STYLE.story}">${md.renderInline(story.title)}</h3>`);
      if (story.body !== '') html.push(md.render(story.body));
      text.push(markdownToText(story.title), '', markdownToText(story.body), '');
    }
  }
  html.push(
    `<p style="${STYLE.footer}"><a href="${escapeHtml(url)}" style="${STYLE.a}">Read this brief on Meridian, with the map and sources</a></p>`,
    '</div></body></html>'
  );
  text.push('', `Read this brief on Meridian, with the map and sources: ${url}`);

  return { subject: `Meridian · ${date} — ${brief.title}`, html: html.join('\n'), text: text.join('\n') };
}
