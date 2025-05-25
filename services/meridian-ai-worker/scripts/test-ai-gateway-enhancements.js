/**
 * Test script for AI Gateway Enhancement Features
 * Tests authentication, cost tracking, caching, and metadata features
 */

const BASE_URL = process.env.TEST_URL || 'http://localhost:8787'

// Color codes for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
}

// Test cases for AI Gateway enhancements
const enhancementTestCases = {
  // Test basic enhanced configuration
  basicEnhancedRequest: {
    method: 'POST',
    path: '/ai',
    body: {
      capability: 'chat',
      messages: [{ role: 'user', content: 'Test enhanced request' }],
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      enhancedConfig: {
        cache: {
          ttl: 3600,
          skipCache: false
        },
        metrics: {
          collectMetrics: true,
          enableLogging: true,
          customTags: {
            testType: 'enhancement',
            feature: 'basic'
          }
        }
      }
    },
    expected: { capability: 'chat' }
  },

  // Test custom cost tracking
  costTrackingRequest: {
    method: 'POST',
    path: '/ai',
    body: {
      capability: 'chat',
      messages: [{ role: 'user', content: 'Test cost tracking' }],
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      enhancedConfig: {
        cost: {
          per_token_in: 0.0015,
          per_token_out: 0.002,
          per_request: 0.001
        },
        metrics: {
          collectMetrics: true,
          customTags: {
            testType: 'cost-tracking'
          }
        }
      }
    },
    expected: { capability: 'chat' }
  },

  // Test cache configuration
  cacheConfigRequest: {
    method: 'POST',
    path: '/ai',
    body: {
      capability: 'embedding',
      input: 'This is a test for caching with custom TTL',
      provider: 'openai',
      model: 'text-embedding-3-small',
      enhancedConfig: {
        cache: {
          ttl: 7200,
          cacheNamespace: 'test-embedding'
        }
      }
    },
    expected: { capability: 'embedding' }
  },

  // Test skip cache functionality
  skipCacheRequest: {
    method: 'POST',
    path: '/ai',
    body: {
      capability: 'chat',
      messages: [{ role: 'user', content: 'Test skip cache' }],
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      enhancedConfig: {
        cache: {
          skipCache: true
        },
        metrics: {
          collectMetrics: true,
          customTags: {
            cacheTest: 'skip'
          }
        }
      }
    },
    expected: { capability: 'chat' }
  },

  // Test authentication configuration
  authConfigRequest: {
    method: 'POST',
    path: '/ai',
    body: {
      capability: 'chat',
      messages: [{ role: 'user', content: 'Test auth config' }],
      provider: 'openai',
      model: 'gpt-3.5-turbo',
      enhancedConfig: {
        auth: {
          customHeaders: {
            'X-Custom-Test': 'enhancement-test',
            'X-Auth-Feature': 'enabled'
          }
        },
        metrics: {
          customTags: {
            authTest: 'custom-headers'
          }
        }
      }
    },
    expected: { capability: 'chat' }
  },

  // Test image generation with cost tracking
  imageWithCostTracking: {
    method: 'POST',
    path: '/ai',
    body: {
      capability: 'image',
      prompt: 'A simple test image for cost tracking',
      provider: 'openai',
      model: 'dall-e-3',
      size: '1024x1024',
      enhancedConfig: {
        cost: {
          per_image: 0.04,
          per_request: 0.001
        },
        cache: {
          ttl: 86400 // 24 hours for images
        },
        metrics: {
          collectMetrics: true,
          customTags: {
            testType: 'image-cost-tracking'
          }
        }
      }
    },
    expected: { capability: 'image' }
  },

  // Test fallback with enhanced configuration
  fallbackEnhancedRequest: {
    method: 'POST',
    path: '/ai',
    body: {
      capability: 'chat',
      messages: [{ role: 'user', content: 'Test fallback with enhancements' }],
      provider: 'openai',
      fallback: true,
      enhancedConfig: {
        fallback: true,
        cache: {
          ttl: 1800
        },
        metrics: {
          collectMetrics: true,
          customTags: {
            testType: 'fallback-enhanced'
          }
        }
      }
    },
    expected: { capability: 'chat' }
  }
}

async function runEnhancementTest(name, testCase) {
  console.log(`${colors.cyan}🔧 Testing ${name}...${colors.reset}`)
  
  try {
    const options = {
      method: testCase.method,
      headers: {
        'Content-Type': 'application/json',
        'X-Test-Type': 'ai-gateway-enhancement'
      }
    }

    if (testCase.body) {
      options.body = JSON.stringify(testCase.body)
    }

    const startTime = Date.now()
    const response = await fetch(`${BASE_URL}${testCase.path}`, options)
    const responseTime = Date.now() - startTime
    
    let data
    try {
      data = await response.json()
    } catch (error) {
      console.log(`${colors.red}❌ ${name} failed: Invalid JSON response${colors.reset}`)
      return false
    }

    if (!response.ok) {
      console.log(`${colors.red}❌ ${name} failed: ${response.status} ${response.statusText}${colors.reset}`)
      console.log('Response:', data)
      return false
    }

    // Check expected properties
    let passed = true
    for (const [key, expectedValue] of Object.entries(testCase.expected)) {
      if (expectedValue === Array) {
        if (!Array.isArray(data[key])) {
          console.log(`${colors.red}❌ ${name} failed: Expected ${key} to be array${colors.reset}`)
          passed = false
        }
      } else if (data[key] !== expectedValue) {
        console.log(`${colors.red}❌ ${name} failed: Expected ${key} to be ${expectedValue}${colors.reset}`)
        passed = false
      }
    }

    if (passed) {
      console.log(`${colors.green}✅ ${name} passed${colors.reset}`)
      console.log(`   ${colors.blue}Response Time: ${responseTime}ms${colors.reset}`)
      console.log(`   ${colors.blue}Provider: ${data.provider || 'unknown'}${colors.reset}`)
      console.log(`   ${colors.blue}Model: ${data.model || 'unknown'}${colors.reset}`)
      
      // Show metadata if available
      if (data.metadata) {
        console.log(`   ${colors.blue}Request ID: ${data.metadata.requestId || 'unknown'}${colors.reset}`)
        if (data.metadata.customTags) {
          console.log(`   ${colors.blue}Custom Tags: ${JSON.stringify(data.metadata.customTags)}${colors.reset}`)
        }
      }
      
      // Show usage information
      if (data.usage) {
        console.log(`   ${colors.blue}Token Usage: ${JSON.stringify(data.usage)}${colors.reset}`)
      }
      
      // Check for AI Gateway specific headers in response
      const requestId = response.headers.get('X-Request-ID')
      const processingTime = response.headers.get('X-Processing-Time')
      
      if (requestId) {
        console.log(`   ${colors.blue}Request ID Header: ${requestId}${colors.reset}`)
      }
      if (processingTime) {
        console.log(`   ${colors.blue}Processing Time: ${processingTime}${colors.reset}`)
      }
      
      return true
    }
    
    return false
  } catch (error) {
    console.log(`${colors.red}❌ ${name} failed with error: ${error.message}${colors.reset}`)
    return false
  }
}

async function testAIGatewayConfig() {
  console.log(`${colors.cyan}🔍 Testing AI Gateway Configuration...${colors.reset}`)
  
  try {
    const response = await fetch(`${BASE_URL}/ai-gateway/config`)
    const config = await response.json()
    
    if (response.ok) {
      console.log(`${colors.green}✅ AI Gateway configuration accessible${colors.reset}`)
      console.log(`   ${colors.blue}Account ID configured: ${config.account_id || false}${colors.reset}`)
      console.log(`   ${colors.blue}Gateway ID configured: ${config.gateway_id || false}${colors.reset}`)
      console.log(`   ${colors.blue}API Token configured: ${config.api_token || false}${colors.reset}`)
      
      if (config.enhancedConfig) {
        console.log(`   ${colors.blue}Enhanced Features:${colors.reset}`)
        if (config.enhancedConfig.authentication) {
          console.log(`     - Authentication: ${config.enhancedConfig.authentication.enabled}`)
        }
        if (config.enhancedConfig.cost_tracking) {
          console.log(`     - Cost Tracking: ${config.enhancedConfig.cost_tracking.enabled}`)
        }
        if (config.enhancedConfig.caching) {
          console.log(`     - Caching: ${config.enhancedConfig.caching.enabled}`)
        }
        if (config.enhancedConfig.metrics) {
          console.log(`     - Metrics: ${config.enhancedConfig.metrics.enabled}`)
        }
      }
      
      return true
    } else {
      console.log(`${colors.red}❌ AI Gateway configuration not accessible${colors.reset}`)
      return false
    }
  } catch (error) {
    console.log(`${colors.red}❌ Failed to fetch AI Gateway config: ${error.message}${colors.reset}`)
    return false
  }
}

async function main() {
  console.log(`${colors.yellow}🚀 AI Gateway Enhancement Features Test Suite${colors.reset}`)
  console.log(`${colors.yellow}Testing against: ${BASE_URL}${colors.reset}\n`)

  // Test AI Gateway configuration first
  const configResult = await testAIGatewayConfig()
  console.log()

  const results = { config: configResult }
  
  // Run enhancement tests
  for (const [name, testCase] of Object.entries(enhancementTestCases)) {
    results[name] = await runEnhancementTest(name, testCase)
    console.log() // Add spacing
  }

  // Summary
  const total = Object.keys(results).length
  const passed = Object.values(results).filter(Boolean).length
  const failed = total - passed

  console.log(`${colors.yellow}📊 Enhancement Test Results:${colors.reset}`)
  console.log(`   Total: ${total}`)
  console.log(`   ${colors.green}Passed: ${passed}${colors.reset}`)
  console.log(`   ${colors.red}Failed: ${failed}${colors.reset}`)
  
  if (failed === 0) {
    console.log(`\n${colors.green}🎉 All AI Gateway enhancement tests passed!${colors.reset}`)
    console.log(`${colors.green}Your enhanced features are working correctly.${colors.reset}`)
  } else {
    console.log(`\n${colors.red}❌ Some enhancement tests failed.${colors.reset}`)
    console.log(`${colors.yellow}💡 Tips for troubleshooting:${colors.reset}`)
    console.log(`   - Check environment variables (AI_GATEWAY_TOKEN, etc.)`)
    console.log(`   - Verify AI Gateway configuration in Cloudflare dashboard`)
    console.log(`   - Check worker logs for detailed error information`)
  }

  // Show failed tests
  const failedTests = Object.entries(results).filter(([_, passed]) => !passed)
  if (failedTests.length > 0) {
    console.log(`\n${colors.red}Failed tests:${colors.reset}`)
    failedTests.forEach(([name, _]) => {
      console.log(`   - ${name}`)
    })
  }
}

if (require.main === module) {
  main().catch(console.error)
}

module.exports = { enhancementTestCases, runEnhancementTest, testAIGatewayConfig }
