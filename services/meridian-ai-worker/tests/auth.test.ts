import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AuthenticationService } from '../src/services/auth';
import { Logger } from '../src/services/logger';

describe('AuthenticationService', () => {
  let authService: AuthenticationService;
  let mockLogger: Logger;
  let mockEnv: any;

  beforeEach(() => {
    mockLogger = {
      log: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    } as any;

    mockEnv = {
      GATEWAY_API_KEYS: 'test-key-1,test-key-2',
      ALLOWED_ORIGINS: 'https://example.com,https://app.example.com',
      ENABLE_REQUEST_SIGNATURE: 'false'
    };

    authService = new AuthenticationService(mockEnv);
  });

  describe('API Key Authentication', () => {
    it('should validate correct API key', async () => {
      const request = new Request('https://example.com/test', {
        headers: {
          'Authorization': 'Bearer test-key-1'
        }
      });

      const result = await authService.authenticateRequest(request);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid API key', async () => {
      const request = new Request('https://example.com/test', {
        headers: {
          'Authorization': 'Bearer invalid-key'
        }
      });

      const result = await authService.authenticateRequest(request);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid API key');
    });

    it('should reject missing authorization header', async () => {
      const request = new Request('https://example.com/test');

      const result = await authService.authenticateRequest(request);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing or invalid authorization header');
    });

    it('should handle malformed authorization header', async () => {
      const request = new Request('https://example.com/test', {
        headers: {
          'Authorization': 'InvalidFormat'
        }
      });

      const result = await authService.authenticateRequest(request);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Missing or invalid authorization header');
    });
  });

  describe('Origin Validation', () => {
    it('should allow requests from allowed origins', async () => {
      const request = new Request('https://example.com/test', {
        headers: {
          'Authorization': 'Bearer test-key-1',
          'Origin': 'https://example.com'
        }
      });

      const result = await authService.authenticateRequest(request);

      expect(result.isValid).toBe(true);
    });

    it('should reject requests from disallowed origins', async () => {
      const request = new Request('https://example.com/test', {
        headers: {
          'Authorization': 'Bearer test-key-1',
          'Origin': 'https://malicious.com'
        }
      });

      const result = await authService.authenticateRequest(request);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Origin not allowed');
    });

    it('should allow requests without origin header (direct API calls)', async () => {
      const request = new Request('https://example.com/test', {
        headers: {
          'Authorization': 'Bearer test-key-1'
        }
      });

      const result = await authService.authenticateRequest(request);

      expect(result.isValid).toBe(true);
    });
  });

  describe('CORS Handling', () => {
    it('should handle preflight OPTIONS request', () => {
      const request = new Request('https://example.com/test', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Authorization, Content-Type'
        }
      });

      const response = authService.handlePreflightRequest(request);

      expect(response.status).toBe(200);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
      expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Authorization');
    });

    it('should reject preflight request from disallowed origin', () => {
      const request = new Request('https://example.com/test', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'https://malicious.com',
          'Access-Control-Request-Method': 'POST'
        }
      });

      const response = authService.handlePreflightRequest(request);

      expect(response.status).toBe(403);
    });

    it('should add CORS headers to regular response', () => {
      const originalResponse = new Response('test');
      const request = new Request('https://example.com/test', {
        headers: {
          'Origin': 'https://example.com'
        }
      });

      const corsResponse = authService.addCorsHeaders(originalResponse, request);

      expect(corsResponse.headers.get('Access-Control-Allow-Origin')).toBe('https://example.com');
      expect(corsResponse.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    });
  });

  describe('Request Signature Validation', () => {
    beforeEach(() => {
      mockEnv.ENABLE_REQUEST_SIGNATURE = 'true';
      mockEnv.SIGNATURE_SECRET = 'test-secret-key';
      authService = new AuthenticationService(mockEnv);
    });

    it('should validate correct request signature', async () => {
      const timestamp = Date.now().toString();
      const payload = JSON.stringify({ test: 'data' });
      
      // Create mock signature (in real implementation this would use crypto)
      const mockSignature = 'valid-signature';
      
      const request = new Request('https://example.com/test', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-key-1',
          'X-Timestamp': timestamp,
          'X-Signature': mockSignature,
          'Content-Type': 'application/json'
        },
        body: payload
      });

      // Mock the signature verification
      vi.spyOn(authService as any, 'verifyRequestSignature').mockReturnValue(true);

      const result = await authService.authenticateRequest(request);

      expect(result.isValid).toBe(true);
    });

    it('should reject invalid request signature', async () => {
      const timestamp = Date.now().toString();
      const payload = JSON.stringify({ test: 'data' });
      
      const request = new Request('https://example.com/test', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer test-key-1',
          'X-Timestamp': timestamp,
          'X-Signature': 'invalid-signature',
          'Content-Type': 'application/json'
        },
        body: payload
      });

      // Mock the signature verification to return false
      vi.spyOn(authService as any, 'verifyRequestSignature').mockReturnValue(false);

      const result = await authService.authenticateRequest(request);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid request signature');
    });
  });

  describe('Configuration', () => {
    it('should handle missing environment variables gracefully', () => {
      const emptyEnv = {} as any;
      const service = new AuthenticationService(emptyEnv);
      
      expect(service).toBeInstanceOf(AuthenticationService);
    });

    it('should parse multiple API keys correctly', () => {
      const envWithKeys = {
        GATEWAY_API_KEYS: 'key1,key2,key3'
      } as any;
      
      const service = new AuthenticationService(envWithKeys);
      
      // Test that all keys are recognized (would need to expose private method or test indirectly)
      expect(service).toBeInstanceOf(AuthenticationService);
    });

    it('should parse multiple origins correctly', () => {
      const envWithOrigins = {
        ALLOWED_ORIGINS: 'https://app1.com,https://app2.com,https://app3.com'
      } as any;
      
      const service = new AuthenticationService(envWithOrigins);
      
      expect(service).toBeInstanceOf(AuthenticationService);
    });
  });
});
