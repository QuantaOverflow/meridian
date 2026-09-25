/**
 * 简报散文摘要生成服务
 * 生产环境错误处理，直接抛出错误而不使用fallback
 */

import { TraceContext, LLMCallPhase } from './llm-call-logger';
import { callLLMUntilAccepted, isTransientLLMError, LLMAttemptsExhausted } from './call-llm';
import { getTldrProsePrompt } from '../prompts/tldrGeneration';
import { CloudflareEnv } from '../types';

const MAX_ATTEMPTS = 4;
const BASE_DELAY_MS = 1000;

// ============================================================================
// 简报生成服务
// ============================================================================

export class BriefGenerationService {
  private traceContext: TraceContext;

  constructor(private env: CloudflareEnv, private ai: Ai, traceContext: TraceContext = {}) {
    this.traceContext = traceContext;
  }

  /**
   * 生成面向读者的散文摘要（reports.tldr_prose）。
   *
   * 给人读的 2-3 句导语。temperature 取 0——摘要要可复现，不需要创造性。
   */
  async generateProseTldr(
    briefTitle: string,
    briefContent: string
  ): Promise<{ success: boolean; data?: { tldrProse: string }; error?: string }> {
    try {
      console.log(`[TLDR Prose] 为简报生成散文摘要`);

      const phase: LLMCallPhase = 'tldr_prose_generation';
      // 只对可自愈错误重试：最多 4 次，指数退避 + 抖动（1s·2^n + [0,1s)）
      const { value: prose } = await callLLMUntilAccepted(this.ai, this.env, this.traceContext, phase, {
        attempts: MAX_ATTEMPTS,
        // 配置走 call-llm 单一入口按 phase 定默认；temperature 显式 0（摘要要可复现）。
        overrides: () => ({
          temperature: 0,
          callIndex: 0,
          metadata: {
            requestId: `brief_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
            timestamp: Date.now(),
          },
        }),
        prompt: () => getTldrProsePrompt(briefTitle, briefContent),
        accept: res => {
          const choice = res.choices?.[0];
          // 空正文到不了这里：workers-ai.ts 的 chat() 对空正文已经抛错
          const response = String(choice?.message?.content ?? '');

          // 截断绝不能静默：打满 max_tokens 时留痕，免得下游把残缺输出当正常摘要。
          if (choice?.finish_reason === 'length') {
            console.warn(`[Brief Generation] 输出被 max_tokens 截断（phase=${phase} chars=${response.length}）`);
          }

          let content = response.trim();
          if (content.startsWith('```') && content.endsWith('```')) {
            content = content.slice(3, -3).trim();
          }
          // 模型偶尔会把整段包在引号里
          if (content.length > 1 && content.startsWith('"') && content.endsWith('"')) {
            content = content.slice(1, -1).trim();
          }

          // 空响应必须当失败抛出去，否则会静默写一条空摘要进库，
          // 读者端只看到标题下少了一段，没有任何报错可查。
          // 抛（而非拒绝）= 不重试：重试也不会变。
          if (content === '') {
            throw new Error('模型返回空摘要');
          }

          return { ok: true, value: content };
        },
        // 错误原样判断，不包前缀：按错误原文决定要不要重试
        retryOnError: (error, attempt) => {
          if (!isTransientLLMError(error)) return false;
          const message = error instanceof Error ? error.message : String(error);
          if (attempt === MAX_ATTEMPTS - 1) {
            console.error(`[TLDR Prose] 重试 ${MAX_ATTEMPTS - 1} 次后仍失败，可自愈错误:`, { error: message, attempt: attempt + 1 });
          } else {
            console.warn(`[TLDR Prose] 可自愈错误，第 ${attempt + 1}/${MAX_ATTEMPTS} 次尝试失败，退避后重试:`, { error: message });
          }
          return true;
        },
        backoffMs: attempt => BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 1000,
      });

      console.log(`[TLDR Prose] 散文摘要生成完成 (${prose.length} 字符)`);
      return { success: true, data: { tldrProse: prose } };

    } catch (e) {
      const error = e instanceof LLMAttemptsExhausted ? e.lastError : e;
      console.error('[TLDR Prose] 生成失败:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }
} 
