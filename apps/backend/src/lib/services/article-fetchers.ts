import { z } from 'zod';
import { parseArticle } from '../api/parsers';
import { userAgents } from '../core/constants';
import { Env } from '../../index';

/**
 * Schema for validating responses from the Cloudflare Browser Rendering API
 */
export const articleSchema = z.object({
  status: z.coerce.boolean(),
  errors: z.array(z.object({ code: z.number(), message: z.string() })).optional(),
  result: z.string(),
});

/**
 * Fetches an article using Cloudflare's Browser Rendering API
 *
 * This method simulates a real browser to handle modern websites with complex
 * JavaScript, cookie consent walls, paywalls, and other obstacles that might
 * prevent content scraping with a regular HTTP client.
 *
 * @param env Application environment with Cloudflare credentials
 * @param url URL of the article to fetch
 * @returns Object containing the parsed article content or throws an error
 */
export async function getArticleWithBrowser(env: Env, url: string) {
  let response: Response;
  
  try {
    response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/browser-rendering/content`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      },
      body: JSON.stringify({
        url,
        userAgent: userAgents[Math.floor(Math.random() * userAgents.length)],
        setExtraHTTPHeaders: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          Connection: 'keep-alive',
          DNT: '1',
          'Accept-Language': 'en-US,en;q=0.5',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Upgrade-Insecure-Requests': '1',
        },
        cookies: [],
        gotoOptions: {
          waitUntil: 'networkidle0',
          timeout: 30000,
          referer: 'https://www.google.com/',
        },
        viewport: {
          width: 390,
          height: 844,
          deviceScaleFactor: 3,
          isMobile: true,
          hasTouch: true,
          isLandscape: false,
        },
        rejectResourceTypes: ['image', 'media', 'font', 'websocket'],
        bestAttempt: true,
        // all of these are very brittle, like all script tag usage
        // this mostly works for now but good to revisit every once in a while
        addScriptTag: [
          // Ensures consistent date formatting by overriding Intl.DateTimeFormat
          // to always use 'en-US' locale regardless of browser settings
          // This prevents inconsistent date parsing across different environments
          {
            content:
              "(() => { Object.defineProperty(Intl, 'DateTimeFormat', { \n    writable: true, \n    value: new Proxy(Intl.DateTimeFormat, { \n      construct: (target, args) => new target('en-US', Object.assign({}, args[1])) \n    })\n  }); })();",
          },
          // Automatically accepts cookie consent popups by finding buttons that contain
          // 'accept' and 'cookie'/'consent' text, then programmatically clicking the first match
          // This bypasses cookie walls that would otherwise block content access
          {
            content:
              "(() => { const cookieButtons = Array.from(document.querySelectorAll(\'button, a\')).filter(el => el.textContent.toLowerCase().includes(\'accept\') && (el.textContent.toLowerCase().includes(\'cookie\') || el.textContent.toLowerCase().includes(\'consent\'))); if(cookieButtons.length > 0) { cookieButtons[0].click(); } })();",
          },
          // Circumvents paywalls by:
          // 1. Removing elements with paywall/subscribe identifiers in id/class
          // 2. Removing modal overlays and fixed position barriers
          // 3. Restoring normal page scroll behavior
          // This targets common paywall implementations across various sites
          {
            content:
              "(() => { const paywallElements = Array.from(document.querySelectorAll(\'div, section\')).filter(el => el.id.toLowerCase().includes(\'paywall\') || el.className.toLowerCase().includes(\'paywall\') || el.id.toLowerCase().includes(\'subscribe\') || el.className.toLowerCase().includes(\'subscribe\')); paywallElements.forEach(el => el.remove()); document.querySelectorAll(\'.modal, .modal-backdrop, body > div[style*=\"position: fixed\"]\').forEach(el => el.remove()); document.body.style.overflow = \'auto\'; })();",
          },
          // Cleans up the DOM by removing non-content elements that interfere with article parsing:
          // - Scripts, styles, iframes that might contain tracking or ads
          // - Ad containers and advertisement blocks
          // - Social media widgets and sharing buttons
          // - Comments sections, navbars, headers, footers (except those within articles)
          // - Various UI elements not relevant to the core article content
          {
            content:
              '(() => { document.querySelectorAll(\'script, style, iframe, .ad, .ads, .advertisement, [class*="social"], [id*="social"], .share, .comments, aside, nav, header:not(article header), footer:not(article footer), [role="complementary"], [role="banner"], [role="navigation"], form, .related, .recommended, .newsletter, .subscription\').forEach(el => el.remove()); })();',
          },
          // Simplifies the DOM by stripping all HTML attributes except essential ones:
          // - href: preserves links
          // - src: maintains images and embedded content
          // - alt: keeps accessibility text for images
          // - title: retains tooltip text
          // This reduces noise and potential tracking parameters in the parsed content
          {
            content:
              "(() => { const keepAttributes = [\'href\', \'src\', \'alt\', \'title\']; document.querySelectorAll(\'*\').forEach(el => { [...el.attributes].forEach(attr => { if (!keepAttributes.includes(attr.name.toLowerCase())) { el.removeAttribute(attr.name); }}); }); })();",
          },
          // Recursively removes empty elements to clean up the DOM structure
          // Continues removing elements until no more empty ones are found
          // This eliminates spacing artifacts and layout containers that serve no content purpose
          {
            content:
              "(() => { function removeEmpty() { let removed = 0; document.querySelectorAll(\'div, span, p, section, article\').forEach(el => { if (!el.hasChildNodes() || el.textContent.trim() === \'\') { el.remove(); removed++; } }); return removed; } let pass; do { pass = removeEmpty(); } while(pass > 0); })();",
          },
          // Removes simple meta tags that provide minimal information value
          // Meta tags with only one attribute are typically not useful for content analysis
          // This helps reduce noise in the document head
          {
            content:
              "(() => { document.querySelectorAll(\'meta\').forEach(meta => { if (meta.attributes.length <= 1) { meta.remove(); } }); })();",
          },
        ],
        waitForSelector: {
          selector: 'article, .article, .content, .post, #article, main',
          timeout: 5000,
        },
      }),
    });
  } catch (error) {
    throw new Error(`Browser fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  let pageContent;
  try {
    pageContent = await response.json();
  } catch (error) {
    throw new Error(`Failed to parse browser response: ${error instanceof Error ? error.message : String(error)}`);
  }

  const parsedPageContent = articleSchema.safeParse(pageContent);
  if (parsedPageContent.success === false) {
    throw new Error(`Browser response validation failed: ${parsedPageContent.error.message}`);
  }

  try {
    const article = parseArticle({ html: parsedPageContent.data.result });
    return article;
  } catch (error) {
    throw new Error(`Article parsing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Fetches an article using a simple HTTP request
 *
 * This is a lighter-weight alternative to browser rendering that works for
 * simpler websites that don't rely heavily on client-side JavaScript for content.
 *
 * @param url URL of the article to fetch
 * @returns The parsed article content or throws an error
 */
export async function getArticleWithFetch(url: string) {
  let response: Response;
  
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': userAgents[Math.floor(Math.random() * userAgents.length)],
        Referer: 'https://www.google.com/',
      },
    });
  } catch (error) {
    throw new Error(`Fetch failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  let html: string;
  try {
    html = await response.text();
  } catch (error) {
    throw new Error(`Failed to read response: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const article = parseArticle({ html });
    return article;
  } catch (error) {
    throw new Error(`Article parsing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
