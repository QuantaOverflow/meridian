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
