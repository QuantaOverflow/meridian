import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { cleanString, cleanUrl } from '../core/utils';
import { Logger } from '../core/logger';

const logger = new Logger({ component: 'rss-parser' });

const rssFeedSchema = z.object({
  title: z.string().min(1),
  link: z.string(),
  pubDate: z.date().nullable(),
});

/**
 * Parses an RSS/XML feed content to extract article information
 *
 * Handles various RSS feed formats and structures while normalizing the output.
 * Extracts titles, links, and publication dates from the feed items.
 *
 * @param xml The XML content of the RSS feed as a string
 * @returns A Promise containing either an array of parsed feed items or throws an error
 */
export async function parseRSSFeed(xml: string): Promise<z.infer<typeof rssFeedSchema>[]> {
  let parsedXml;
  
  try {
    parsedXml = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' }).parse(xml);
  } catch (error) {
    throw new Error(`RSS Parse error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // handle various feed structures
  let items = parsedXml.rss?.channel?.item || parsedXml.feed?.entry || parsedXml.item || parsedXml['rdf:RDF']?.item || [];

  // handle single item case
  items = Array.isArray(items) ? items : [items];

  const properItems = items.map((item: any) => {
    let title = '';
    let link = '';
    let pubDateString: string | null = null;

    if (typeof item.title === 'string') {
      title = item.title;
    } else if (typeof item.title === 'object' && item.title['#text']) {
      title = item.title['#text'];
    } else {
      title = 'UNKNOWN';
    }

    if (typeof item.link === 'string') {
      link = item.link;
    } else if (typeof item.link === 'object' && item.link['@_href']) {
      link = item.link['@_href'];
    } else if (typeof item.guid === 'string') {
      link = item.guid;
    } else {
      link = 'UNKNOWN';
    }

    if (typeof item.pubDate === 'string') {
      pubDateString = item.pubDate;
    } else if (typeof item.published === 'string') {
      pubDateString = item.published;
    } else if (typeof item.updated === 'string') {
      pubDateString = item.updated;
    }

    let pubDate: Date | null = null;
    if (pubDateString) {
      pubDate = new Date(pubDateString);
      if (isNaN(pubDate.getTime())) {
        pubDate = null;
      }
    }

    // 链接解析不了（缺 link、guid 不是 URL 等）只跳过这一条：cleanUrl 会抛错，
    // 不接住的话一条坏条目就让整个 feed 解析失败、这一轮一篇都进不来。
    let cleanedLink: string;
    try {
      cleanedLink = cleanUrl(cleanString(link));
    } catch {
      logger.warn(`[RSS] 跳过链接无法解析的条目: title=${JSON.stringify(title).slice(0, 120)} link=${JSON.stringify(link).slice(0, 200)}`);
      return null;
    }

    return {
      title: cleanString(title),
      link: cleanedLink,
      pubDate,
    };
  }).filter((item: unknown) => item !== null);

  // standardize the items
  const parsedItems = z.array(rssFeedSchema).safeParse(properItems);
  if (parsedItems.success === false) {
    throw new Error(`RSS Validation error: ${parsedItems.error.message}`);
  }

  return parsedItems.data;
}

/** linkedom 节点上用到的几个字段（tsconfig 不带 DOM lib） */
type DomNode = { nodeType: number; nodeName: string; nodeValue: string | null; childNodes: ArrayLike<DomNode> };

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'CAPTION', 'DD', 'DETAILS', 'DIV', 'DL', 'DT', 'FIELDSET',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN',
  'NAV', 'OL', 'P', 'PRE', 'SECTION', 'SUMMARY', 'TABLE', 'TBODY', 'TFOOT', 'THEAD', 'TR', 'UL',
]);

/**
 * 正文按块断行。Readability 的 textContent 把块级元素首尾直接拼接：压缩过的网页（标签之间没有空白）
 * 段落、小标题、图注全黏成一行，2026-10-04 一天 418 篇里 323 篇正文只有一行。
 * 这里逐个文本节点拼：节点内的空白（源码排版的折行、缩进）折成一个空格，块级元素前后补换行，
 * <br> 换行，表格同一行的格子用空格隔开。<pre> 里的换行是内容，原样保留。
 * 只动空白：非空白字符与 textContent 逐字相同（当天 353 个页面实测全部相同）。
 */
function blockText(root: DomNode): string {
  const parts: string[] = [];
  const walk = (node: DomNode, inPre: boolean) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        const text = child.nodeValue ?? '';
        parts.push(inPre ? text : text.replace(/\s+/g, ' '));
      } else if (child.nodeType === ELEMENT_NODE) {
        const tag = child.nodeName.toUpperCase();
        if (tag === 'BR') {
          parts.push('\n');
        } else if (tag === 'TD' || tag === 'TH') {
          parts.push(' ');
          walk(child, inPre);
          parts.push(' ');
        } else {
          const block = BLOCK_TAGS.has(tag);
          if (block) parts.push('\n');
          walk(child, inPre || tag === 'PRE');
          if (block) parts.push('\n');
        }
      }
    }
  };
  walk(root, false);
  return parts.join('');
}

/**
 * Parses HTML content to extract article text and metadata
 *
 * Uses Mozilla Readability to identify and extract the main content
 * from an HTML document, ignoring navigation, ads, and other non-content elements.
 *
 * @param opts Object containing the HTML content to parse
 * @returns The parsed article data or throws an error
 */
export function parseArticle(opts: { html: string }) {
  let article;

  try {
    // serializer 原样交回正文节点（默认是序列化成 HTML 字符串），供 blockText 按块断行
    article = new Readability<DomNode>(parseHTML(opts.html).document, { serializer: node => node as DomNode }).parse();
  } catch (error) {
    throw new Error(`Article parsing error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // if we can't parse the article or there is no article, not much we can do
  if (article === null || !article.title || !article.textContent || !article.content) {
    throw new Error('No article content found');
  }

  return {
    title: article.title,
    text: cleanString(blockText(article.content)),
    publishedTime: article.publishedTime || undefined,
  };
}
