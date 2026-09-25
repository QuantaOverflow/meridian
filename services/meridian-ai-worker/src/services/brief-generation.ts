/**
 * 简报散文摘要生成服务
 * 生产环境错误处理，直接抛出错误而不使用fallback
 */

import { AIGatewayService } from './ai-gateway';
import { TraceContext, LLMCallPhase } from './llm-call-logger';
import { callLLM } from './call-llm';
import { getTldrProsePrompt } from '../prompts/tldrGeneration';
import { CloudflareEnv } from '../types';
import { QuotaHandler } from '../utils/quota-handler';

// ============================================================================
// 简报生成服务
// ============================================================================

export class BriefGenerationService {
  private aiGatewayService: AIGatewayService;
  private traceContext: TraceContext;

  constructor(private env: CloudflareEnv, traceContext: TraceContext = {}) {
    this.aiGatewayService = new AIGatewayService(env);
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

      const aiOperation = async () => {
        const prompt = getTldrProsePrompt(briefTitle, briefContent);

        const response = await this.callAI(prompt, 'tldr_prose_generation');

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
        if (content === '') {
          throw new Error('模型返回空摘要');
        }

        return content;
      };

      const prose = await QuotaHandler.retryWithBackoff(aiOperation);

      console.log(`[TLDR Prose] 散文摘要生成完成 (${prose.length} 字符)`);
      return { success: true, data: { tldrProse: prose } };

    } catch (error) {
      console.error('[TLDR Prose] 生成失败:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  // ============================================================================
  // 私有辅助方法
  // ============================================================================

  // 错误原样抛出，不再包一层前缀：QuotaHandler 按错误原文判断要不要重试
  private async callAI(prompt: string, phase: LLMCallPhase): Promise<string> {
    // 配置走 call-llm 单一入口按 phase 定默认；temperature 显式 0（摘要要可复现）。
    const result = await callLLM(
      this.aiGatewayService,
      this.env,
      this.traceContext,
      phase,
      [{ role: 'user' as const, content: prompt }],
      {
        temperature: 0,
        callIndex: 0,
        metadata: {
          requestId: `brief_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
          timestamp: Date.now(),
        },
      }
    );

    const choice = result.choices?.[0];
    const content = choice?.message?.content;
    if (!content) {
      throw new Error('模型返回空正文');
    }

    // 截断绝不能静默：打满 max_tokens 时留痕，免得下游把残缺输出当正常摘要。
    if (choice?.finish_reason === 'length') {
      console.warn(`[Brief Generation] 输出被 max_tokens 截断（phase=${phase} chars=${content.length}）`);
    }

    return content;
  }

} 