import { describe, it, expect, vi, beforeEach } from 'vitest';
import app from '../src/index'; // 导入 Hono 应用程序实例

// 模拟 AIGatewayService 及其 chat 方法
vi.mock('../src/services/ai-gateway', () => ({
  AIGatewayService: vi.fn(() => ({
    chat: vi.fn(), // 模拟 chat 方法
  })),
}));

// 模拟提示词生成函数
vi.mock('../src/prompts/briefGeneration', () => ({
  getBriefGenerationSystemPrompt: vi.fn(),
  getBriefGenerationPrompt: vi.fn(),
  getBriefTitlePrompt: vi.fn(),
}));

vi.mock('../src/prompts/tldrGeneration', () => ({
  getTldrGenerationPrompt: vi.fn(),
}));

// 导入模拟的函数，以便在测试中设置其行为
import { AIGatewayService } from '../src/services/ai-gateway';
import { 
  getBriefGenerationSystemPrompt, 
  getBriefGenerationPrompt, 
  getBriefTitlePrompt 
} from '../src/prompts/briefGeneration';
import { getTldrGenerationPrompt } from '../src/prompts/tldrGeneration';

describe('Brief Generation Endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ==========================================================================
  // /meridian/generate-final-brief 端点测试
  // ==========================================================================
  
  describe('POST /meridian/generate-final-brief', () => {
    
    // --- 输入验证测试 ---
    it('应该在缺少 analysisData 时返回 400 错误', async () => {
      const res = await app.request('/meridian/generate-final-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), // analysisData 缺失
      });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid request: analysisData array is required');
    });

    it('应该在 analysisData 不是数组时返回 400 错误', async () => {
      const res = await app.request('/meridian/generate-final-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisData: "not-an-array" }),
      });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid request: analysisData array is required');
    });

    // --- 成功场景测试：基本简报生成 ---
    it('应该成功生成简报（无前一日简报）', async () => {
      const mockAnalysisData = [
        {
          executiveSummary: 'AI技术重大突破',
          storyStatus: '持续发展',
          timeline: [
            { date: '2024-01-01', description: 'AI新算法发布', importance: 'High' }
          ],
          significance: {
            assessment: 'High',
            reasoning: '对行业影响深远'
          },
          undisputedKeyFacts: ['AI算法性能提升50%', '多家公司参与研发'],
          keySources: {
            contradictions: [
              { issue: '商业化时间存在争议' }
            ]
          },
          keyEntities: {
            list: [
              { name: 'OpenAI', type: 'Company', involvement: '主要开发者' }
            ]
          },
          informationGaps: ['具体技术细节未公开'],
          signalStrength: {
            assessment: 'Strong'
          }
        }
      ];

      const mockBriefContent = `
<final_brief>
# AI技术突破简报

## 关键发展

今日AI技术取得重大突破，多家公司参与研发。

## 重要性评估

这一突破对行业影响深远，预计将改变现有技术格局。
</final_brief>
      `;

      const mockTitleContent = '```json\n{"title": "AI技术突破每日简报"}\n```';

      // 设置模拟函数返回值
      (getBriefGenerationSystemPrompt as vi.Mock).mockReturnValue('简报生成系统提示词');
      (getBriefGenerationPrompt as vi.Mock).mockReturnValue('简报生成用户提示词');
      (getBriefTitlePrompt as vi.Mock).mockReturnValue('标题生成提示词');

      // 模拟两次 AI Gateway 调用：简报生成 + 标题生成
      const mockChatImplementation = vi.fn()
        .mockResolvedValueOnce({
          capability: 'chat',
          choices: [{ message: { content: mockBriefContent } }],
          model: 'gemini-2.0-flash',
          provider: 'google-ai-studio',
          processingTime: 150,
          cached: false,
          usage: { total_tokens: 1500 }
        })
        .mockResolvedValueOnce({
          capability: 'chat',
          choices: [{ message: { content: mockTitleContent } }],
          model: 'gemini-2.0-flash',
          provider: 'google-ai-studio',
          processingTime: 50,
          cached: false,
          usage: { total_tokens: 200 }
        });

      (AIGatewayService as vi.Mock).mockImplementation(() => ({
        chat: mockChatImplementation,
      }));

      const res = await app.request('/meridian/generate-final-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisData: mockAnalysisData }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.title).toBe('AI技术突破每日简报');
      expect(data.data.content).toContain('AI技术突破简报');
      expect(data.data.content).toContain('关键发展');
      expect(data.data.metadata.sections_processed).toBe(1);
      expect(data.data.metadata.has_previous_context).toBe(false);
      expect(data.data.metadata.model_used).toBe('gemini-2.0-flash');
      expect(data.usage.brief_generation.total_tokens).toBe(1500);
      expect(data.usage.title_generation.total_tokens).toBe(200);

      // 验证调用了正确的提示词生成函数
      expect(getBriefGenerationSystemPrompt).toHaveBeenCalled();
      expect(getBriefGenerationPrompt).toHaveBeenCalledWith(
        expect.stringContaining('AI技术重大突破'), // 检查 markdown 转换
        '' // 无前一日简报
      );
      expect(getBriefTitlePrompt).toHaveBeenCalledWith(
        expect.stringContaining('AI技术突破简报')
      );
    });

    // --- 成功场景测试：包含前一日简报 ---
    it('应该成功生成简报（包含前一日简报上下文）', async () => {
      const mockAnalysisData = [
        {
          executiveSummary: '区块链技术进展',
          storyStatus: '稳步推进'
        }
      ];

      const mockPreviousBrief = {
        date: '2024-01-01',
        title: '前日技术简报',
        tldr: '昨日重点：AI算法优化，区块链应用扩展'
      };

      const mockBriefContent = '<final_brief>\n# 区块链技术进展简报\n\n今日区块链技术取得新进展。\n</final_brief>';
      const mockTitleContent = '```json\n{"title": "区块链技术进展简报"}\n```';

      (getBriefGenerationSystemPrompt as vi.Mock).mockReturnValue('系统提示词');
      (getBriefGenerationPrompt as vi.Mock).mockReturnValue('用户提示词');
      (getBriefTitlePrompt as vi.Mock).mockReturnValue('标题提示词');

      const mockChatImplementation = vi.fn()
        .mockResolvedValueOnce({
          capability: 'chat',
          choices: [{ message: { content: mockBriefContent } }],
          model: 'gemini-2.0-flash',
          provider: 'google-ai-studio',
          processingTime: 120,
          cached: false,
          usage: { total_tokens: 1200 }
        })
        .mockResolvedValueOnce({
          capability: 'chat',
          choices: [{ message: { content: mockTitleContent } }],
          model: 'gemini-2.0-flash',
          provider: 'google-ai-studio',
          processingTime: 40,
          cached: false,
          usage: { total_tokens: 150 }
        });

      (AIGatewayService as vi.Mock).mockImplementation(() => ({
        chat: mockChatImplementation,
      }));

      const res = await app.request('/meridian/generate-final-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          analysisData: mockAnalysisData,
          previousBrief: mockPreviousBrief
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.title).toBe('区块链技术进展简报');
      expect(data.data.metadata.has_previous_context).toBe(true);

      // 验证包含了前一日简报上下文
      expect(getBriefGenerationPrompt).toHaveBeenCalledWith(
        expect.stringContaining('区块链技术进展'),
        expect.stringContaining('Previous Day\'s Coverage Context (2024-01-01)')
      );
    });

    // --- 错误处理测试：标题解析失败 ---
    it('应该在标题解析失败时使用默认标题', async () => {
      const mockAnalysisData = [{ executiveSummary: '测试故事' }];
      
      const mockBriefContent = '<final_brief>\n# 测试简报\n\n测试内容。\n</final_brief>';
      const mockInvalidTitleContent = '无效的JSON内容，不是标准格式';

      (getBriefGenerationSystemPrompt as vi.Mock).mockReturnValue('系统提示词');
      (getBriefGenerationPrompt as vi.Mock).mockReturnValue('用户提示词');
      (getBriefTitlePrompt as vi.Mock).mockReturnValue('标题提示词');

      const mockChatImplementation = vi.fn()
        .mockResolvedValueOnce({
          capability: 'chat',
          choices: [{ message: { content: mockBriefContent } }],
          model: 'gemini-2.0-flash',
          provider: 'google-ai-studio',
          processingTime: 100,
          cached: false,
          usage: { total_tokens: 1000 }
        })
        .mockResolvedValueOnce({
          capability: 'chat',
          choices: [{ message: { content: mockInvalidTitleContent } }],
          model: 'gemini-2.0-flash',
          provider: 'google-ai-studio',
          processingTime: 30,
          cached: false,
          usage: { total_tokens: 100 }
        });

      (AIGatewayService as vi.Mock).mockImplementation(() => ({
        chat: mockChatImplementation,
      }));

      const res = await app.request('/meridian/generate-final-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisData: mockAnalysisData }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.title).toBe('daily intelligence brief'); // 默认标题
      expect(data.data.content).toContain('测试简报');
    });

    // --- 错误处理测试：AI Gateway 失败 ---
    it('应该在AI Gateway调用失败时返回 500 错误', async () => {
      const mockAnalysisData = [{ executiveSummary: '测试故事' }];

      (getBriefGenerationSystemPrompt as vi.Mock).mockReturnValue('系统提示词');
      (getBriefGenerationPrompt as vi.Mock).mockReturnValue('用户提示词');

      (AIGatewayService as vi.Mock).mockImplementation(() => ({
        chat: vi.fn().mockRejectedValue(new Error('AI Gateway error')),
      }));

      const res = await app.request('/meridian/generate-final-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisData: mockAnalysisData }),
      });
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Failed to generate final brief');
      expect(data.details).toBe('AI Gateway error');
    });
  });

  // ==========================================================================
  // /meridian/generate-brief-tldr 端点测试
  // ==========================================================================
  
  describe('POST /meridian/generate-brief-tldr', () => {
    
    // --- 输入验证测试 ---
    it('应该在缺少 briefTitle 时返回 400 错误', async () => {
      const res = await app.request('/meridian/generate-brief-tldr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefContent: '测试内容' }), // briefTitle 缺失
      });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid request: briefTitle and briefContent are required');
    });

    it('应该在缺少 briefContent 时返回 400 错误', async () => {
      const res = await app.request('/meridian/generate-brief-tldr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ briefTitle: '测试标题' }), // briefContent 缺失
      });
      const data = await res.json();

      expect(res.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Invalid request: briefTitle and briefContent are required');
    });

    // --- 成功场景测试：基本 TLDR 生成 ---
    it('应该成功生成 TLDR', async () => {
      const mockBriefTitle = 'AI技术突破每日简报';
      const mockBriefContent = `
# AI技术突破简报

## 关键发展

今日AI技术取得重大突破，多家公司参与研发。

## 重要性评估

这一突破对行业影响深远，预计将改变现有技术格局。
      `;

      const mockTldrContent = `
• AI算法性能提升50%，多家科技公司参与研发
• 新算法在图像识别和自然语言处理方面表现突出  
• 商业化应用预计在未来6个月内推出
• 行业专家认为这一突破将重塑AI应用格局
      `;

      (getTldrGenerationPrompt as vi.Mock).mockReturnValue('TLDR生成提示词');

      (AIGatewayService as vi.Mock).mockImplementation(() => ({
        chat: vi.fn().mockResolvedValue({
          capability: 'chat',
          choices: [{ message: { content: mockTldrContent } }],
          model: 'gemini-2.0-flash',
          provider: 'google-ai-studio',
          processingTime: 80,
          cached: false,
          usage: { total_tokens: 500 }
        }),
      }));

      const res = await app.request('/meridian/generate-brief-tldr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          briefTitle: mockBriefTitle,
          briefContent: mockBriefContent
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.tldr).toContain('AI算法性能提升50%');
      expect(data.data.tldr).toContain('商业化应用预计');
      expect(data.data.story_count).toBe(4); // 4个有效行
      expect(data.data.metadata.brief_title).toBe(mockBriefTitle);
      expect(data.data.metadata.brief_length).toBe(mockBriefContent.length);
      expect(data.data.metadata.model_used).toBe('gemini-2.0-flash');
      expect(data.data.metadata.total_tokens).toBe(500);
      expect(data.usage.total_tokens).toBe(500);

      // 验证调用了正确的提示词生成函数
      expect(getTldrGenerationPrompt).toHaveBeenCalledWith(
        mockBriefTitle,
        mockBriefContent
      );
    });

    // --- 成功场景测试：清理 markdown 代码块 ---
    it('应该正确清理markdown代码块标记', async () => {
      const mockBriefTitle = '测试简报';
      const mockBriefContent = '测试内容';

      // 模拟LLM返回带代码块标记的内容
      const mockTldrWithCodeBlocks = `\`\`\`
• 第一个要点
• 第二个要点
• 第三个要点
\`\`\``;

      (getTldrGenerationPrompt as vi.Mock).mockReturnValue('TLDR生成提示词');

      (AIGatewayService as vi.Mock).mockImplementation(() => ({
        chat: vi.fn().mockResolvedValue({
          capability: 'chat',
          choices: [{ message: { content: mockTldrWithCodeBlocks } }],
          model: 'gemini-2.0-flash',
          provider: 'google-ai-studio',
          processingTime: 60,
          cached: false,
          usage: { total_tokens: 300 }
        }),
      }));

      const res = await app.request('/meridian/generate-brief-tldr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          briefTitle: mockBriefTitle,
          briefContent: mockBriefContent
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.tldr).not.toContain('```'); // 代码块标记被清理
      expect(data.data.tldr).toContain('第一个要点');
      expect(data.data.story_count).toBe(3); // 3个有效行
    });

    // --- 成功场景测试：自定义选项 ---
    it('应该支持自定义provider和model选项', async () => {
      const mockBriefTitle = '自定义选项测试';
      const mockBriefContent = '测试内容';
      const mockTldrContent = '• 自定义模型测试要点';

      (getTldrGenerationPrompt as vi.Mock).mockReturnValue('TLDR生成提示词');

      (AIGatewayService as vi.Mock).mockImplementation(() => ({
        chat: vi.fn().mockResolvedValue({
          capability: 'chat',
          choices: [{ message: { content: mockTldrContent } }],
          model: 'custom-model',
          provider: 'custom-provider',
          processingTime: 70,
          cached: false,
          usage: { total_tokens: 400 }
        }),
      }));

      const res = await app.request('/meridian/generate-brief-tldr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          briefTitle: mockBriefTitle,
          briefContent: mockBriefContent,
          options: {
            provider: 'custom-provider',
            model: 'custom-model'
          }
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.metadata.model_used).toBe('custom-model');
      expect(data.data.tldr).toContain('自定义模型测试要点');
    });

    // --- 错误处理测试：AI Gateway 失败 ---
    it('应该在AI Gateway调用失败时返回 500 错误', async () => {
      const mockBriefTitle = '错误测试简报';
      const mockBriefContent = '错误测试内容';

      (getTldrGenerationPrompt as vi.Mock).mockReturnValue('TLDR生成提示词');

      (AIGatewayService as vi.Mock).mockImplementation(() => ({
        chat: vi.fn().mockRejectedValue(new Error('TLDR AI Gateway error')),
      }));

      const res = await app.request('/meridian/generate-brief-tldr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          briefTitle: mockBriefTitle,
          briefContent: mockBriefContent
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Failed to generate brief TLDR');
      expect(data.details).toBe('TLDR AI Gateway error');
    });

    // --- 错误处理测试：意外响应类型 ---
    it('应该在AI Gateway返回意外响应类型时抛出错误', async () => {
      const mockBriefTitle = '意外响应测试';
      const mockBriefContent = '测试内容';

      (getTldrGenerationPrompt as vi.Mock).mockReturnValue('TLDR生成提示词');

      (AIGatewayService as vi.Mock).mockImplementation(() => ({
        chat: vi.fn().mockResolvedValue({
          capability: 'embedding', // 错误的响应类型
          data: []
        }),
      }));

      const res = await app.request('/meridian/generate-brief-tldr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          briefTitle: mockBriefTitle,
          briefContent: mockBriefContent
        }),
      });
      const data = await res.json();

      expect(res.status).toBe(500);
      expect(data.success).toBe(false);
      expect(data.error).toBe('Failed to generate brief TLDR');
      expect(data.details).toBe('Unexpected response type from chat service');
    });
  });
}); 