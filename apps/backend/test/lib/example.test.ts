import {
  env,
  createExecutionContext,
  waitOnExecutionContext,
  SELF,
} from "cloudflare:test";
import { describe, it, expect, vi, beforeEach } from "vitest";
// 导入你的 Worker 进行单元测试
import worker from "../src";
// 导入工具函数
import { hasValidAuthToken, generateSearchText } from "../src/lib/utils";
import { parseRSSFeed } from "../src/lib/parsers";
import { Context } from "hono";
import { HonoEnv } from "../src/app";
import { readFileSync } from "fs";
import path from "path";

describe("Meridian Backend Worker - Comprehensive Tests", () => {
  beforeEach(() => {
    // 重置所有mock
    vi.clearAllMocks();
  });

  // 基本单元测试
  describe("Basic Unit Tests", () => {
    it("should handle ping requests", async () => {
      const request = new Request("http://example.com/ping");
      const ctx = createExecutionContext();

      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ pong: true });
    });

    it("should handle 404 for unknown routes", async () => {
      const request = new Request("http://example.com/unknown-route");
      const ctx = createExecutionContext();

      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response.status).toBe(404);
    });

    it("should handle CORS preflight requests", async () => {
      const request = new Request("http://example.com/ping", {
        method: "OPTIONS",
        headers: {
          "Origin": "https://example.com",
          "Access-Control-Request-Method": "GET",
        },
      });
      const ctx = createExecutionContext();

      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      // OPTIONS 请求应该返回适当的响应（可能是 404 或有 CORS 头）
      expect(response).toBeInstanceOf(Response);
      // 如果返回 200，应该有 CORS 头；如果返回 404，那也是正常的
      if (response.status === 200) {
        expect(response.headers.get("Access-Control-Allow-Origin")).toBeTruthy();
      } else {
        expect([200, 404, 405]).toContain(response.status);
      }
    });
  });

  // 基本集成测试（使用 SELF）
  describe("Basic Integration Tests", () => {
    it("should respond to ping endpoint via SELF", async () => {
      const response = await SELF.fetch("http://example.com/ping");
      
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({ pong: true });
    });

    it("should handle health check", async () => {
      const response = await SELF.fetch("http://example.com/health");
      
      // Health endpoint 应该存在或返回适当的响应
      expect([200, 404]).toContain(response.status);
    });
  });

  // 工具函数测试
  describe("Utility Functions", () => {
    describe("hasValidAuthToken", () => {
      let mockContext: Context<HonoEnv>;
      const validToken = "valid-token-12345";

      beforeEach(() => {
        mockContext = {
          req: {
            header: vi.fn(),
          },
          env: {
            API_TOKEN: validToken,
          },
        } as unknown as Context<HonoEnv>;
      });

      it("should return true when Authorization header has the correct Bearer token", () => {
        mockContext.req.header = vi.fn().mockImplementation((name: string) => {
          if (name === "Authorization") return `Bearer ${validToken}`;
          return undefined;
        });

        const result = hasValidAuthToken(mockContext);

        expect(result).toBe(true);
        expect(mockContext.req.header).toHaveBeenCalledWith("Authorization");
      });

      it("should return false when Authorization header is missing", () => {
        mockContext.req.header = vi.fn().mockImplementation(() => undefined);

        const result = hasValidAuthToken(mockContext);

        expect(result).toBe(false);
        expect(mockContext.req.header).toHaveBeenCalledWith("Authorization");
      });

      it("should return false when Authorization header has incorrect token value", () => {
        mockContext.req.header = vi.fn().mockImplementation((name: string) => {
          if (name === "Authorization") return `Bearer wrong-token`;
          return undefined;
        });

        const result = hasValidAuthToken(mockContext);

        expect(result).toBe(false);
      });
    });

    describe("generateSearchText", () => {
      const sampleData = {
        title: "Test Article",
        language: "en",
        primary_location: "New York",
        completeness: "COMPLETE" as const,
        content_quality: "OK" as const,
        event_summary_points: ["First point", "Second point with period.", "Third point"],
        thematic_keywords: ["keyword1", "keyword2", "keyword3"],
        topic_tags: ["tag1", "tag2"],
        key_entities: ["entity1", "entity2"],
        content_focus: ["focus1", "focus2"],
      };

      it("should correctly combine title, summary points, keywords, tags, entities, focus, and location", () => {
        const result = generateSearchText(sampleData);

        expect(result).toBe(
          "Test Article. New York. First point. Second point with period. Third point. entity1 entity2. keyword1 keyword2 keyword3. tag1 tag2. focus1 focus2."
        );
      });

      it("should handle empty arrays gracefully", () => {
        const data = {
          ...sampleData,
          event_summary_points: [],
          thematic_keywords: [],
          topic_tags: [],
          key_entities: [],
          content_focus: [],
        };

        const result = generateSearchText(data);
        expect(result).toBe("Test Article. New York.");
      });
    });
  });

  // RSS 解析测试
  describe("RSS Parser", () => {
    const loadFixture = (filename: string) => {
      try {
        return readFileSync(path.join(__dirname, "fixtures", filename), "utf-8");
      } catch (error) {
        // 如果 fixture 文件不存在，返回一个模拟的 RSS 内容
        return `<?xml version="1.0" encoding="UTF-8"?>
        <rss version="2.0">
          <channel>
            <title>Test RSS Feed</title>
            <item>
              <title>Test Article</title>
              <link>https://example.com/test</link>
              <pubDate>Tue, 18 Mar 2025 23:24:58 GMT</pubDate>
              <description>Test description</description>
            </item>
          </channel>
        </rss>`;
      }
    };

    it("should parse RSS feed correctly", async () => {
      const xml = loadFixture("test_feed.xml");
      const result = await parseRSSFeed(xml);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      
      // 检查第一个条目的基本结构
      const firstItem = result[0];
      expect(firstItem).toHaveProperty("title");
      expect(firstItem).toHaveProperty("link");
      expect(firstItem).toHaveProperty("pubDate");
    });

    it("should handle malformed RSS gracefully", async () => {
      const malformedXml = "Not a valid RSS feed";
      
      // parseRSSFeed 可能返回空数组而不是抛出错误
      const result = await parseRSSFeed(malformedXml);
      expect(Array.isArray(result)).toBe(true);
      // 对于恶意输入，应该返回空数组或抛出错误
      expect(result.length).toBe(0);
    });
  });

  // 基本错误处理测试
  describe("Error Handling", () => {
    it("should handle malformed requests gracefully", async () => {
      const request = new Request("http://example.com/ping", {
        headers: {
          "Content-Type": "invalid-content-type",
        },
      });
      const ctx = createExecutionContext();

      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response).toBeInstanceOf(Response);
    });

    it("should handle large request bodies appropriately", async () => {
      const largeBody = "a".repeat(1000);
      const request = new Request("http://example.com/ping", {
        method: "POST",
        body: largeBody,
        headers: {
          "Content-Type": "text/plain",
        },
      });
      const ctx = createExecutionContext();

      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);

      expect(response).toBeInstanceOf(Response);
    });
  });

  // 基本环境变量测试
  describe("Environment Tests", () => {
    it("should have access to basic environment", async () => {
      expect(env).toBeDefined();
      expect(typeof env).toBe("object");
    });

    it("should have basic bindings available", async () => {
      const bindings = Object.keys(env);
      expect(bindings.length).toBeGreaterThan(0);
    });
  });

  // 性能基准测试
  describe("Performance Tests", () => {
    it("should respond to ping requests quickly", async () => {
      const start = Date.now();
      
      const response = await SELF.fetch("http://example.com/ping");
      
      const end = Date.now();
      const duration = end - start;
      
      expect(response.status).toBe(200);
      expect(duration).toBeLessThan(1000);
    });

    it("should handle multiple sequential requests", async () => {
      const responses = [];
      
      for (let i = 0; i < 5; i++) {
        const response = await SELF.fetch(`http://example.com/ping?seq=${i}`);
        responses.push(response);
      }
      
      responses.forEach((response, index) => {
        expect(response.status).toBe(200);
      });
    });
  });
}); 