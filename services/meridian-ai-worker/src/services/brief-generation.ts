/**
 * 简报生成服务
 * 基于 intelligence-pipeline.test.ts 的简报生成契约
 * 生产环境错误处理，直接抛出错误而不使用fallback
 */

import { AIGatewayService } from './ai-gateway';
import { TraceContext, LLMCallPhase } from './llm-call-logger';
import { callLLM } from './call-llm';
import { getTldrGenerationPrompt, getTldrProsePrompt } from '../prompts/tldrGeneration';
import { CloudflareEnv, ChatResponse } from '../types';
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
   * 生成TLDR摘要 - 生产环境版本，直接抛出错误
   */
  async generateTLDR(
    briefTitle: string, 
    briefContent: string
  ): Promise<{ success: boolean; data?: { tldr: string }; error?: string }> {
    try {
      console.log(`[TLDR Generation] 为简报生成TLDR`);

      // AI生成（带重试策略，失败时直接抛出错误）
      const aiOperation = async () => {
        const tldrPrompt = getTldrGenerationPrompt(briefTitle, briefContent);
        
        const response = await this.callAI(tldrPrompt, undefined, {
          temperature: 0,
          phase: 'tldr_generation',
          callIndex: 0
        });
        
        // 清理TLDR内容
        let content = response.trim();
        if (content.startsWith('```') && content.endsWith('```')) {
          content = content.slice(3, -3).trim();
        }

        return content;
      };

      const tldrContent = await QuotaHandler.retryWithBackoff(aiOperation);

      console.log(`[TLDR Generation] TLDR生成完成`);
      return {
        success: true,
        data: { tldr: tldrContent }
      };

    } catch (error) {
      console.error('[TLDR Generation] 生成失败:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      };
    }
  }

  /**
   * 生成面向读者的散文摘要（reports.tldr_prose）。
   *
   * 与 generateTLDR 并列但用途相反：那个产出给次日模型读的机器格式，这个产出给人读的
   * 2-3 句导语。temperature 取 0 与 generateTLDR 一致——摘要要可复现，不需要创造性。
   */
  async generateProseTldr(
    briefTitle: string,
    briefContent: string
  ): Promise<{ success: boolean; data?: { tldrProse: string }; error?: string }> {
    try {
      console.log(`[TLDR Prose] 为简报生成散文摘要`);

      const aiOperation = async () => {
        const prompt = getTldrProsePrompt(briefTitle, briefContent);

        const response = await this.callAI(prompt, undefined, {
          temperature: 0,
          phase: 'tldr_prose_generation',
          callIndex: 0
        });

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

  private async callAI(
    prompt: string,
    systemPrompt?: string,
    options: {
      provider?: string; model?: string; temperature?: number; maxTokens?: number;
      phase?: LLMCallPhase; callIndex?: number;
      /** 约束式解码。不传即原行为。 */
      responseFormat?: { type: 'json_schema'; json_schema: Record<string, unknown> } | { type: 'json_object' };
      /** 复读抑制。见 CallLLMOverrides 的注释：生效已实测，但会一并压正常重复。 */
      frequencyPenalty?: number;
      presencePenalty?: number;
      /** 内部用：标记这次已经是「截断后加倍预算」的重问，防止无限翻倍。 */
      __retriedForLength?: boolean;
    } = {}
  ): Promise<string> {
    const messages = systemPrompt
      ? [
          { role: 'system' as const, content: systemPrompt },
          { role: 'user' as const, content: prompt }
        ]
      : [{ role: 'user' as const, content: prompt }];

    try {
      // 配置走 call-llm 单一入口按 phase 定默认；temperature ?? 语义保留（5 处显式 0 不被吞）。
      const result = await callLLM(
        this.aiGatewayService,
        this.env,
        this.traceContext,
        options.phase ?? 'brief_generation',
        messages,
        {
          provider: options.provider,
          model: options.model,
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          callIndex: options.callIndex ?? this.traceContext.callIndex,
          responseFormat: options.responseFormat,
          frequencyPenalty: options.frequencyPenalty,
          presencePenalty: options.presencePenalty,
          metadata: {
            requestId: `brief_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`,
            timestamp: Date.now(),
          },
        }
      );
      
      // 检查结果是否存在
      if (!result) {
        throw new Error('AI Gateway request failed: No response received');
      }
      
      // 检查响应类型
      if (result.capability !== 'chat') {
        throw new Error(`Unexpected response type from chat service: ${result.capability || 'undefined'}`);
      }

      const choice = (result as ChatResponse).choices?.[0];
      const content = choice?.message?.content;
      if (!content) {
        throw new Error('AI Gateway returned empty content');
      }

      // 截断绝不能静默。约束式解码只管形状不管长度：数组能合法地一直长下去，写到预算用尽
      // 就断在半个字符串里，下游 parseLooseJSON 拿不到东西，报的却是「响应无 X 字段」——
      // 读起来像模型不配合，实际是我们给少了。2026-09-09 实测 18 块里 12 块栽在这上面。
      if (choice?.finish_reason === 'length') {
        const budget = options.maxTokens ?? 0;
        console.warn(
          `[Brief Generation] 输出被 max_tokens 截断（phase=${options.phase ?? 'brief_generation'} ` +
            `callIndex=${options.callIndex ?? '-'} budget=${budget} chars=${content.length}）`
        );
        // 结构化输出的调用截断就是废品（残缺 JSON），加倍预算重问一次。
        // 只重问一次：连续两次打满说明是 prompt 让它停不下来，那是别的问题，别在这里烧钱。
        if (options.responseFormat && budget > 0 && !options.__retriedForLength) {
          console.warn(`[Brief Generation] 结构化输出被截断 → 预算 ${budget} → ${budget * 2} 重问一次`);
          return await this.callAI(prompt, systemPrompt, {
            ...options, maxTokens: budget * 2, __retriedForLength: true,
          });
        }
      }

      return content;
    } catch (error) {
      // 改善错误消息，提供更多上下文
      const errorMessage = error instanceof Error ? error.message : 'Unknown AI Gateway error';
      throw new Error(`AI Gateway request failed: ${errorMessage}`);
    }
  }

} 