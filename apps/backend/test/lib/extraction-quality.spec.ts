import { describe, expect, it } from 'vitest';
import { looksLikeExtractionFailure } from '../../src/lib/core/extraction-quality';

// 2026-09-25 生产抓到的 politico 正文（R2 2026/9/25/1139531.txt 原文）：Cloudflare 人机验证页。
// 浏览器渲染 token 配好后第一次能抓回页面，这页被当正文一路走到 PROCESSED（LLM 分析、embedding 都跑了）。
const CF_CHALLENGE_POLITICO = "www.politico.comPerforming security verificationThis website uses a security service to protect against malicious bots. This page is displayed while the website verifies you are not a bot.Incompatible browser extension or network configurationYour browser extensions or network settings have blocked the security verification process required by www.politico.com. To resolve this, try the following steps:Temporarily disable browser extensions:Go to your browser settings.Locate your browser extensions and temporarily disable them.Once browser extensions are disabled, refresh this page.Check your network settings:Verify if your internet or firewall settings have blocked your device from reaching “challenges.cloudflare.com”. You may need to consult your operating system's help documentation or your network administrator for guidance on adjusting firewall settings.If you do not have permission to adjust network settings, try connecting to a different network.If these steps do not resolve the issue, refer to Cloudflare's troubleshooting documentation for more help. For detailed guidance on how to disable your browser extensions or check your network settings, refer to your browser or device’s documentation.";

describe('looksLikeExtractionFailure', () => {
  it('Cloudflare 人机验证页判为抓取失败', () => {
    expect(looksLikeExtractionFailure(CF_CHALLENGE_POLITICO)).toEqual({ fail: true, reason: 'block_page' });
  });
});
