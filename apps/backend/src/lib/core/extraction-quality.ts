// 抓取/解析质量:判 Readability 抽出的"正文"是否其实是抓取/解析失败的产物,或 URL 就非新闻页。
// 纯函数、零依赖——故可被 backend runtime 与 scripts/eval/scrape-quality 共用(单一真源、免漂移)。
// 签名/规则源自真实数据 + 73 条开放编码金标(precision 1.00 / recall 0.93,详见
// scripts/eval/scrape-quality 与记忆 scrape-extraction-eval)。

// 抓取/解析失败签名:抓到的"正文"其实是反爬拦截页 / 视频播放器 stub / 登录墙 / 限流页 / 非文章页。
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
