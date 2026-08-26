import MarkdownIt from 'markdown-it';

/**
 * 简报正文的结构化解析。
 *
 * 后端 briefGeneration prompt 产出的 markdown 只用两种结构记号：
 *   `## heading`          —— 模型按当天内容自行命名的板块
 *   `<u>**title**</u>`    —— 板块内的一个事件条目，其后若干段落属于它
 * 末尾固定有一个 `## noteworthy & under-reported` 板块，内容是无序列表、没有事件条目。
 *
 * 旧前端把整块 markdown 丢给 v-html，读者因此看不到板块/条目的层级，也没法做目录、
 * 速读折叠、逐条锚点。这里把它还原成树，渲染交给页面组件。
 */

const md = new MarkdownIt({ linkify: true, breaks: true, typographer: true, html: true });

/** `## 板块名` —— ### 少见但也当板块处理，简报只需要一层板块 */
const SECTION_RE = /^#{2,4}\s+(.+?)\s*$/;
/**
 * `<u>事件标题</u>` 独占一行。
 * 粗体是可选的：2026-08-25 换 prompt 之后模型写 `<u>**title**</u>`，之前写 `<u>title</u>`，
 * 库里两种都有，都得认。
 */
const STORY_RE = /^\s*<u>(.+?)<\/u>\s*$/;

/**
 * 排在最前的若干条按「头条」规格渲染（30px），其余按常规（25px）。
 *
 * 设计稿的两级规格来自故事重要度，但重要度只存在 brief_stories 表里，而那张表的
 * 标题（`US — Trump administration proposes $103,265 H-1B visa fee`）和正文里模型
 * 自己写的标题（`h-1b price hike`）词面对不上，只能模糊匹配——宁可不猜。
 * prompt 已经要求「most consequential first」，直接吃这个既有顺序。
 */
const HEADLINE_STORY_COUNT = 2;

const WORDS_PER_MINUTE = 300;

export interface BriefStory {
  /** 锚点 id，供侧栏目录跳转 */
  id: string;
  title: string;
  /** 首段，速读模式下唯一可见的正文 */
  leadHtml: string;
  /** 第二段起，速读模式隐藏 */
  restHtml: string;
  headline: boolean;
}

export interface BriefSection {
  id: string;
  heading: string;
  /** 板块下不属于任何事件条目的内容（如 noteworthy 板块的清单） */
  leadHtml: string;
  stories: BriefStory[];
}

export interface ParsedBrief {
  sections: BriefSection[];
  storyCount: number;
  readingMinutes: number;
}

function renderBlock(lines: string[]): string {
  const text = lines.join('\n').trim();
  return text === '' ? '' : md.render(text).trim();
}

/** 把一段已渲染的 HTML 拆成「首段」与「其余」，用于速读/深读分层 */
function splitLeadParagraph(html: string): { leadHtml: string; restHtml: string } {
  if (html === '') return { leadHtml: '', restHtml: '' };

  const end = html.indexOf('</p>');
  if (end === -1) return { leadHtml: html, restHtml: '' };

  return {
    leadHtml: html.slice(0, end + 4),
    restHtml: html.slice(end + 4).trim(),
  };
}

/**
 * 剥掉散文摘要里的行内 markdown 标记。
 *
 * prompt 已经写了「no markdown」，但模型仍会零星带出 `*magnifica humanitas*` 这类斜体
 * （72 期里有 5 期）。摘要是当纯文本渲染的，不处理就会显示成字面星号。
 *
 * 刻意在**读取侧**做而不是生成侧：已经落库的那批不用重跑就一并修好。
 * 也刻意不动下划线——散文里少见，但误伤 snake_case 的风险实打实。
 */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/`(.+?)`/g, '$1');
}

export function estimateReadingMinutes(content: string): number {
  if (!content) return 0;
  return Math.ceil(content.trim().split(/\s+/).length / WORDS_PER_MINUTE);
}

/**
 * 抹掉模型漏进正文的 prompt 内部变量名。
 *
 * 模型没内容可写时会用自己的输入容器名跟读者解释，例如
 * 「There are no clusters related to China ... in the provided <curated_news_data>」。
 * 该 token 被转义成实体后**读者会看到字面量**，像系统出错。72 期里有 3 期（#13/#21/#50）。
 *
 * 这是**上游内容问题**，正解是在 prompt 里禁止模型提及输入容器；这里只是给历史期兜底，
 * 换成读者能懂的说法，不改变句意。新增 token 请连同这条注释一起更新。
 */
function stripPromptArtifacts(text: string): string {
  return text
    .replace(/<\/?curated_news_data>/g, '本期采集到的数据')
    .replace(/<\/?final_brief>/g, '');
}

export function parseBriefContent(content: string): ParsedBrief {
  const sections: BriefSection[] = [];
  let section: BriefSection | null = null;
  let story: BriefStory | null = null;
  let buffer: string[] = [];
  let storyCount = 0;

  const openSection = (heading: string) => {
    story = null;
    section = { id: `section-${sections.length + 1}`, heading, leadHtml: '', stories: [] };
    sections.push(section);
    return section;
  };

  /** 把攒着的行归到当前条目，没有当前条目就归到板块导语 */
  const flush = () => {
    const html = renderBlock(buffer);
    buffer = [];
    if (html === '') return;

    if (story !== null) {
      const { leadHtml, restHtml } = splitLeadParagraph(html);
      story.leadHtml = leadHtml;
      story.restHtml = restHtml;
      return;
    }

    // 部分历史简报正文直接开写、没有任何 ## 开头，补一个无名板块兜住
    const target = section ?? openSection('');
    target.leadHtml = target.leadHtml === '' ? html : `${target.leadHtml}\n${html}`;
  };

  for (const line of stripPromptArtifacts(content ?? '').split('\n')) {
    const sectionMatch = line.match(SECTION_RE);
    if (sectionMatch !== null) {
      flush();
      openSection(md.renderInline(sectionMatch[1]));
      continue;
    }

    const storyMatch = line.match(STORY_RE);
    if (storyMatch !== null) {
      flush();
      const current = section ?? openSection('');
      storyCount += 1;
      story = {
        id: `story-${storyCount}`,
        // 去掉包在标题外面的 **，内部若还有 markdown 交给 renderInline
        title: md.renderInline(storyMatch[1].trim().replace(/^\*\*/, '').replace(/\*\*$/, '').trim()),
        leadHtml: '',
        restHtml: '',
        headline: storyCount <= HEADLINE_STORY_COUNT,
      };
      current.stories.push(story);
      continue;
    }

    buffer.push(line);
  }
  flush();

  return {
    // 旧模板期（如 `## global landscape`）留下过只有标题、底下什么都没有的空板块，
    // 渲染出来是一条孤零零的延伸横线，丢掉
    sections: sections.filter(s => s.leadHtml !== '' || s.stories.length > 0),
    storyCount,
    readingMinutes: estimateReadingMinutes(content),
  };
}
