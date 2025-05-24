import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MetadataService } from '../src/services/metadata';
import { Logger } from '../src/services/logger';

describe('MetadataService', () => {
  let metadataService: MetadataService;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    } as any;

    metadataService = new MetadataService();
  });

  describe('Request Metadata Creation', () => {
    it('should create request metadata with required fields', () => {
      const request = new Request('https://example.com/test', {
        headers: {
          'Authorization': 'Bearer test-key',
          'User-Agent': 'Mozilla/5.0 Test Browser',
          'Origin': 'https://app.example.com'
        }
      });

      const metadata = metadataService.createRequestMetadata(request);

      expect(metadata.requestId).toMatch(/^req_[a-zA-Z0-9]{16}$/);
      expect(metadata.timestamp).toBeDefined();
      expect(new Date(metadata.timestamp)).toBeInstanceOf(Date);
      expect(metadata.source?.origin).toBe('https://app.example.com');
      expect(metadata.source?.userAgent).toBe('Mozilla/5.0 Test Browser');
    });

    it('should handle requests without optional headers', () => {
      const request = new Request('https://example.com/test');

      const metadata = metadataService.createRequestMetadata(request);

      expect(metadata.requestId).toBeDefined();
      expect(metadata.timestamp).toBeDefined();
      expect(metadata.source?.origin).toBeUndefined();
      expect(metadata.source?.userAgent).toBeUndefined();
    });

    it('should extract Cloudflare headers when available', () => {
      const request = new Request('https://example.com/test', {
        headers: {
          'CF-IPCountry': 'US',
          'CF-Region': 'California',
          'CF-Colo': 'SFO',
          'CF-Connecting-IP': '192.168.1.1'
        }
      });

      const metadata = metadataService.createRequestMetadata(request);

      expect(metadata.cloudflare?.country).toBe('US');
      expect(metadata.cloudflare?.region).toBe('California');
      expect(metadata.cloudflare?.colo).toBe('SFO');
      expect(metadata.source?.ip).toBe('192.168.1.1');
    });
  });

  describe('Authentication Metadata', () => {
    it('should enrich metadata with authentication info', () => {
      const baseMetadata = {
        requestId: 'req_1234567890abcdef',
        timestamp: Date.now(),
        source: {}
      };

      const authResult = {
        isValid: true,
        apiKeyHash: 'sha256:abcdef123456',
        errors: []
      };

      const enrichedMetadata = metadataService.enrichWithAuthInfo(baseMetadata, authResult);

      expect(enrichedMetadata.auth?.authenticated).toBe(true);
      expect(enrichedMetadata.auth?.apiKeyHash).toBe('sha256:abcdef123456');
      expect(enrichedMetadata.auth?.errors).toEqual([]);
    });

    it('should handle authentication failures', () => {
      const baseMetadata = {
        requestId: 'req_1234567890abcdef',
        timestamp: Date.now(),
        source: {}
      };

      const authResult = {
        isValid: false,
        errors: ['Invalid API key', 'Origin not allowed']
      };

      const enrichedMetadata = metadataService.enrichWithAuthInfo(baseMetadata, authResult);

      expect(enrichedMetadata.auth?.authenticated).toBe(false);
      expect(enrichedMetadata.auth?.errors).toEqual(['Invalid API key', 'Origin not allowed']);
      expect(enrichedMetadata.auth?.apiKeyHash).toBeUndefined();
    });
  });

  describe('Processing Metadata', () => {
    it('should add processing information', () => {
      const baseMetadata = {
        requestId: 'req_1234567890abcdef',
        timestamp: Date.now(),
        source: {},
        auth: { authenticated: true }
      };

      const processingInfo = {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        startTime: Date.now()
      };

      const enrichedMetadata = metadataService.enrichWithProcessingInfo(
        baseMetadata,
        processingInfo
      );

      expect(enrichedMetadata.processing?.provider).toBe('openai');
      expect(enrichedMetadata.processing?.model).toBe('gpt-3.5-turbo');
      expect(enrichedMetadata.processing?.startTime).toBe(processingInfo.startTime);
    });

    it('should calculate duration when endTime is provided', () => {
      const baseMetadata = {
        requestId: 'req_1234567890abcdef',
        timestamp: Date.now(),
        source: {},
        auth: { authenticated: true }
      };

      const startTime = Date.now();
      const endTime = startTime + 1500; // 1.5 seconds later

      const processingInfo = {
        provider: 'openai',
        model: 'gpt-3.5-turbo',
        startTime,
        endTime
      };

      const enrichedMetadata = metadataService.enrichWithProcessingInfo(
        baseMetadata,
        processingInfo
      );

      expect(enrichedMetadata.processing?.duration).toBe(1500);
    });
  });

  describe('Performance Metrics', () => {
    it('should add performance metrics', () => {
      const baseMetadata = {
        requestId: 'req_1234567890abcdef',
        timestamp: Date.now(),
        source: {},
        auth: { authenticated: true },
        processing: {
          provider: 'openai',
          model: 'gpt-3.5-turbo',
          startTime: Date.now()
        }
      };

      const performanceMetrics = {
        tokenUsage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30
        },
        latency: {
          gatewayLatency: 50,
          providerLatency: 1400,
          totalLatency: 1450
        },
        cost: {
          estimatedCost: 0.000045,
          currency: 'USD'
        }
      };

      const enrichedMetadata = metadataService.addPerformanceMetrics(
        baseMetadata,
        performanceMetrics
      );

      expect(enrichedMetadata.performance).toEqual(performanceMetrics);
    });

    it('should handle partial performance metrics', () => {
      const baseMetadata = {
        requestId: 'req_1234567890abcdef',
        timestamp: Date.now(),
        source: {},
        auth: { authenticated: true }
      };

      const partialMetrics = {
        tokenUsage: {
          promptTokens: 10,
          completionTokens: 20,
          totalTokens: 30
        }
      };

      const enrichedMetadata = metadataService.addPerformanceMetrics(
        baseMetadata,
        partialMetrics
      );

      expect(enrichedMetadata.performance?.tokenUsage).toEqual(partialMetrics.tokenUsage);
      expect(enrichedMetadata.performance?.latency).toBeUndefined();
      expect(enrichedMetadata.performance?.cost).toBeUndefined();
    });
  });

  describe('Error Tracking', () => {
    it('should track errors in metadata', () => {
      const baseMetadata = {
        requestId: 'req_1234567890abcdef',
        timestamp: Date.now(),
        source: {},
        auth: { authenticated: true }
      };

      const error = new Error('503 Service Unavailable');
      const errorInfo = {
        type: 'ProviderError',
        message: error.message,
        code: 503,
        retryAttempts: 2
      };

      const enrichedMetadata = metadataService.addErrorInfo(baseMetadata, errorInfo);

      expect(enrichedMetadata.error).toEqual(errorInfo);
    });

    it('should categorize different error types', () => {
      const baseMetadata = {
        requestId: 'req_1234567890abcdef',
        timestamp: Date.now(),
        source: {}
      };

      const authError = {
        type: 'AuthenticationError',
        message: 'Invalid API key',
        code: 401
      };

      const networkError = {
        type: 'NetworkError',
        message: 'Connection timeout',
        code: 408
      };

      const authMetadata = metadataService.addErrorInfo(baseMetadata, authError);
      const networkMetadata = metadataService.addErrorInfo(baseMetadata, networkError);

      expect(authMetadata.error?.type).toBe('AuthenticationError');
      expect(networkMetadata.error?.type).toBe('NetworkError');
    });
  });

  describe('Request ID Generation', () => {
    it('should generate unique request IDs', () => {
      const ids = new Set();
      
      for (let i = 0; i < 1000; i++) {
        const id = (metadataService as any).generateRequestId();
        expect(ids.has(id)).toBe(false);
        ids.add(id);
        expect(id).toMatch(/^req_[a-zA-Z0-9]{16}$/);
      }
    });

    it('should generate IDs with consistent format', () => {
      for (let i = 0; i < 100; i++) {
        const id = (metadataService as any).generateRequestId();
        expect(id).toMatch(/^req_[a-zA-Z0-9]{16}$/);
        expect(id.length).toBe(20); // 'req_' + 16 characters
      }
    });
  });

  describe('Sanitization', () => {
    it('should sanitize sensitive data in headers', () => {
      const request = new Request('https://example.com/test', {
        headers: {
          'Authorization': 'Bearer secret-api-key',
          'X-API-Key': 'another-secret',
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 Test'
        }
      });

      const metadata = metadataService.createRequestMetadata(request);

      // Should not contain sensitive headers in raw form
      expect(JSON.stringify(metadata)).not.toContain('secret-api-key');
      expect(JSON.stringify(metadata)).not.toContain('another-secret');
      
      // Should contain non-sensitive headers
      expect(JSON.stringify(metadata)).toContain('application/json');
      expect(JSON.stringify(metadata)).toContain('Mozilla/5.0 Test');
    });

    it('should handle custom metadata without exposing sensitive fields', () => {
      const baseMetadata = {
        requestId: 'req_1234567890abcdef',
        timestamp: Date.now(),
        source: {}
      };

      const customMetadata = {
        userId: 'user_123',
        sessionId: 'session_456',
        password: 'should-not-appear',
        secret: 'also-should-not-appear',
        feature: 'chat_assistant'
      };

      const enrichedMetadata = metadataService.enrichWithCustomData(
        baseMetadata,
        customMetadata
      );

      const serialized = JSON.stringify(enrichedMetadata);
      
      expect(serialized).toContain('user_123');
      expect(serialized).toContain('session_456');
      expect(serialized).toContain('chat_assistant');
      expect(serialized).not.toContain('should-not-appear');
      expect(serialized).not.toContain('also-should-not-appear');
    });
  });

  describe('Cloudflare Integration', () => {
    it('should extract comprehensive Cloudflare metadata', () => {
      const request = new Request('https://example.com/test', {
        headers: {
          'CF-IPCountry': 'US',
          'CF-Region': 'California', 
          'CF-Colo': 'SFO',
          'CF-Connecting-IP': '203.0.113.1',
          'CF-Ray': '1234567890abcdef',
          'CF-Visitor': '{"scheme":"https"}',
          'CF-Worker': 'test-worker'
        }
      });

      const metadata = metadataService.createRequestMetadata(request);

      expect(metadata.cloudflare).toEqual({
        country: 'US',
        region: 'California',
        colo: 'SFO',
        ray: '1234567890abcdef',
        visitor: '{"scheme":"https"}',
        worker: 'test-worker'
      });
      
      expect(metadata.source?.ip).toBe('203.0.113.1');
    });

    it('should handle missing Cloudflare headers gracefully', () => {
      const request = new Request('https://example.com/test', {
        headers: {
          'User-Agent': 'Mozilla/5.0 Test'
        }
      });

      const metadata = metadataService.createRequestMetadata(request);

      expect(metadata.cloudflare).toBeUndefined();
      expect(metadata.source?.ip).toBeUndefined();
      expect(metadata.source?.userAgent).toBe('Mozilla/5.0 Test');
    });
  });

  describe('Metadata Serialization', () => {
    it('should produce JSON-serializable metadata', () => {
      const request = new Request('https://example.com/test', {
        headers: {
          'Authorization': 'Bearer test-key',
          'User-Agent': 'Mozilla/5.0 Test',
          'Origin': 'https://app.example.com'
        }
      });

      const metadata = metadataService.createRequestMetadata(request);
      
      expect(() => JSON.stringify(metadata)).not.toThrow();
      
      const serialized = JSON.stringify(metadata);
      const parsed = JSON.parse(serialized);
      
      expect(parsed.requestId).toBe(metadata.requestId);
      expect(parsed.timestamp).toBe(metadata.timestamp);
    });

    it('should handle circular references in custom data', () => {
      const baseMetadata = {
        requestId: 'req_1234567890abcdef',
        timestamp: Date.now(),
        source: {}
      };

      const circularData: any = { name: 'test' };
      circularData.self = circularData; // Create circular reference

      const customMetadata = {
        userId: 'user_123',
        circularData
      };

      expect(() => {
        metadataService.enrichWithCustomData(baseMetadata, customMetadata);
      }).not.toThrow();
    });
  });
});
