
/**
 * Test script for Meridian AI Worker v2.0
 * Tests the new capability-based architecture
 */

const BASE_URL = 'http://localhost:8787'  // Default Wrangler dev server

// Test cases for different capabilities
const testCases = {
  health: {
    method: 'GET',
    path: '/health',
    expected: { status: 'ok' }
  },
  
  providers: {
    method: 'GET', 
    path: '/providers',
    expected: { providers: Array }
  },

  chatUnified: {
    method: 'POST',
    path: '/ai',
    body: {
      capability: 'chat',
      messages: [
        { role: 'user', content: 'Hello, please respond with just "Hello back!"' }
      ],
      provider: 'openai',
      model: 'gpt-3.5-turbo'
    },
    expected: { capability: 'chat', choices: Array }
  },

  chatBackwardCompatible: {
    method: 'POST',
    path: '/chat', 
    body: {
      messages: [
        { role: 'user', content: 'Hello, please respond with just "Hello back!"' }
      ]
    },
    expected: { capability: 'chat', choices: Array }
  },

  embedding: {
    method: 'POST',
    path: '/ai',
    body: {
      capability: 'embedding',
      input: 'This is a test sentence for embedding',
      provider: 'openai',
      model: 'text-embedding-3-small'
    },
    expected: { capability: 'embedding', data: Array }
  },

  embeddingEndpoint: {
    method: 'POST',
    path: '/embed',
    body: {
      input: 'This is a test sentence for embedding'
    },
    expected: { capability: 'embedding', data: Array }
  },

  imageGeneration: {
    method: 'POST',
    path: '/ai',
    body: {
      capability: 'image',
      prompt: 'A simple red circle on white background',
      provider: 'openai',
      model: 'dall-e-3',
      size: '1024x1024'
    },
    expected: { capability: 'image', data: Array }
  },

  imageEndpoint: {
    method: 'POST',
    path: '/images/generate',
    body: {
      prompt: 'A simple blue square on white background'
    },
    expected: { capability: 'image', data: Array }
  },

  capabilityProviders: {
    method: 'GET',
    path: '/capabilities/chat/providers',
    expected: { capability: 'chat', providers: Array }
  }
}

// Color codes for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m'
}

async function runTest(name, testCase) {
  console.log(`${colors.blue}🧪 Testing ${name}...${colors.reset}`)
  
  try {
    const options = {
      method: testCase.method,
      headers: {
        'Content-Type': 'application/json'
      }
    }

    if (testCase.body) {
      options.body = JSON.stringify(testCase.body)
    }

    const response = await fetch(`${BASE_URL}${testCase.path}`, options)
    const data = await response.json()

    if (!response.ok) {
      console.log(`${colors.red}❌ ${name} failed: ${response.status} ${response.statusText}${colors.reset}`)
      console.log('Response:', data)
      return false
    }

    // Check expected properties
    let passed = true
    for (const [key, expectedType] of Object.entries(testCase.expected)) {
      if (expectedType === Array) {
        if (!Array.isArray(data[key])) {
          console.log(`${colors.red}❌ ${name} failed: Expected ${key} to be array${colors.reset}`)
          passed = false
        }
      } else if (typeof expectedType === 'object') {
        if (typeof data[key] !== 'object') {
          console.log(`${colors.red}❌ ${name} failed: Expected ${key} to be object${colors.reset}`)
          passed = false
        }
      } else {
        if (data[key] !== expectedType) {
          console.log(`${colors.red}❌ ${name} failed: Expected ${key} to be ${expectedType}${colors.reset}`)
          passed = false
        }
      }
    }

    if (passed) {
      console.log(`${colors.green}✅ ${name} passed${colors.reset}`)
      if (name.includes('chat') || name.includes('embedding') || name.includes('image')) {
        console.log(`   Provider: ${data.provider || 'unknown'}`)
        console.log(`   Model: ${data.model || 'unknown'}`)
        if (data.usage) {
          console.log(`   Usage: ${JSON.stringify(data.usage)}`)
        }
      }
      return true
    }
    
    return false
  } catch (error) {
    console.log(`${colors.red}❌ ${name} failed with error: ${error.message}${colors.reset}`)
    return false
  }
}

async function main() {
  console.log(`${colors.yellow}🚀 Meridian AI Worker v2.0 Test Suite${colors.reset}`)
  console.log(`${colors.yellow}Testing against: ${BASE_URL}${colors.reset}\n`)

  const results = {}
  
  for (const [name, testCase] of Object.entries(testCases)) {
    results[name] = await runTest(name, testCase)
    console.log() // Add spacing
  }

  // Summary
  const total = Object.keys(results).length
  const passed = Object.values(results).filter(Boolean).length
  const failed = total - passed

  console.log(`${colors.yellow}📊 Test Results Summary:${colors.reset}`)
  console.log(`   Total: ${total}`)
  console.log(`   ${colors.green}Passed: ${passed}${colors.reset}`)
  console.log(`   ${colors.red}Failed: ${failed}${colors.reset}`)
  
  if (failed === 0) {
    console.log(`\n${colors.green}🎉 All tests passed! Your v2.0 architecture is working correctly.${colors.reset}`)
  } else {
    console.log(`\n${colors.red}❌ Some tests failed. Please check the worker logs for details.${colors.reset}`)
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

main().catch(console.error)
