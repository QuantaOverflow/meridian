import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { cleanString, cleanUrl } from '../core/utils';

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
    let id = '';
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

    if (typeof item.guid === 'string') {
      id = item.guid;
    } else if (typeof item.guid === 'object' && item.guid['#text']) {
      id = item.guid['#text'];
    } else {
      id = 'UNKNOWN';
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

    return {
      title: cleanString(title),
      link: cleanUrl(cleanString(link)),
      id: cleanString(id),
      pubDate,
    };
  });

  // standardize the items
  const parsedItems = z.array(rssFeedSchema).safeParse(properItems);
  if (parsedItems.success === false) {
    throw new Error(`RSS Validation error: ${parsedItems.error.message}`);
  }

  return parsedItems.data;
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
    article = new Readability(parseHTML(opts.html).document).parse();
  } catch (error) {
    throw new Error(`Article parsing error: ${error instanceof Error ? error.message : String(error)}`);
  }

  // if we can't parse the article or there is no article, not much we can do
  if (article === null || !article.title || !article.textContent) {
    throw new Error('No article content found');
  }

  return {
    title: article.title,
    text: cleanString(article.textContent),
    publishedTime: article.publishedTime || undefined,
  };
}

// 抓取/解析失败签名:Readability 抽到的"正文"其实是反爬拦截页 / 视频播放器 stub / 登录墙 /
// 限流页 / 非文章页,而非真正文。签名逐字源自真实样本,经 73 条开放编码金标验证
// (precision 1.00 / recall 0.87,远超现机械门 6/31)。详见记忆 scrape-extraction-eval。
// gated 签名(视频 / 站点 footer)要求短文本——真文章尾部也常挂视频/footer boilerplate,
// 凭出现就判失败会误杀长真文章(实测 FP 源)。
const EXTRACTION_FAILURE_SIGNATURES: Array<{ re: RegExp; reason: string; gated: boolean }> = [
  { re: /to display this content from youtube|enable advertisement tracking and audience measurement/i, reason: 'video_stub', gated: true },
  { re: /please enable js and disable any ad blocker|your ip (?:.*)?has been blocked|you don'?t have permission to access|access denied|errors\.edgesuite|are you a robot|page not found|does not exist or is not available|not available anymore/i, reason: 'block_page', gated: false },
  { re: /please log in to see this page|not logged in|log in or sign up to view/i, reason: 'login_wall', gated: false },
  { re: /abuse detection mechanism|\brate limit\b|too many requests/i, reason: 'rate_limit', gated: false },
  { re: /all trademarks are property of their respective owners|this stream is best experienced/i, reason: 'non_article', gated: true },
];

/**
 * 判断 Readability 抽出的"正文"是否其实是抓取/解析失败的产物(拦截页/视频stub/登录墙/限流/非文章)。
 * 纯确定性、保守:只在命中明确签名(视频/footer 还要求短文本)或极短+导航 stub 时判失败。
 * 用于在喂 LLM 分析/聚类之前把这类 junk 拦掉(processArticles),并作 brief 时质量门的兜底。
 */
export function looksLikeExtractionFailure(text: string): { fail: boolean; reason?: string } {
  if (!text || text.trim().length === 0) return { fail: true, reason: 'empty' };
  for (const s of EXTRACTION_FAILURE_SIGNATURES) {
    if (s.re.test(text) && (!s.gated || text.length < 800)) return { fail: true, reason: s.reason };
  }
  // 极短 + 含导航标记 → nav/boilerplate stub
  if (text.length < 200 && /skip to (main )?content|navigation menu/i.test(text)) return { fail: true, reason: 'nav_stub' };
  return { fail: false };
}

// 结构性非新闻页:URL 一看就不是新闻文章(代码仓页/商店/活动流/社媒视频)。抽取本身可能成功,
// 但内容不是可用新闻。保守只列明确模式——对 80 条金标 URL 命中 5 条全非新闻、0 真文章误伤。
// 与内容签名互补:这类页 URL 可判,省得抓完再靠内容/LLM。
export function looksLikeNonArticleUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl);
    const h = url.hostname.replace(/^www\./, '');
    const p = url.pathname;
    if (h === 'github.com' && /^\/[^/]+\/[^/]+\/(pull|issues|blob|tree|commit)\//.test(p)) return 'github_code';
    if (h.endsWith('steampowered.com')) return 'store_page';
    if (h === 'apple.com' && p.startsWith('/apple-events')) return 'event_page';
    if (h === 'fb.watch' || (h.endsWith('facebook.com') && p.startsWith('/watch'))) return 'social_video';
    return null;
  } catch {
    return null;
  }
}
