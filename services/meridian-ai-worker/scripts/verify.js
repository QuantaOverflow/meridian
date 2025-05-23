#!/usr/bin/env node

// Test script to verify the AI Worker setup
const testData = {
  chatRequest: {
    messages: [
      {
        role: "user",
        content: "Hello, this is a test message"
      }
    ],
    provider: "openai",
    model: "gpt-4o-mini",
    temperature: 0.7,
    max_tokens: 100,
    fallback: true
  }
};

console.log('🚀 Testing meridian-ai-worker setup...');
console.log('📝 Sample chat request:', JSON.stringify(testData.chatRequest, null, 2));

// Check if TypeScript files compile
const { execSync } = require('child_process');
const path = require('path');

try {
  console.log('\n🔍 Checking TypeScript compilation...');
  const projectRoot = path.dirname(__dirname);
  execSync('npx tsc --noEmit', { 
    stdio: 'inherit', 
    cwd: projectRoot 
  });
  console.log('✅ TypeScript compilation successful!');
} catch (error) {
  console.error('❌ TypeScript compilation failed:', error.message);
  process.exit(1);
}

console.log('\n✅ All checks passed! The AI Worker is ready for development.');
console.log('\n📝 Next steps:');
console.log('1. Set up your environment variables using: wrangler secret put <KEY_NAME>');
console.log('2. Start development server: npm run dev');
console.log('3. Test the endpoints using curl or Postman');
console.log('\n🔗 Available endpoints:');
console.log('  - GET  /health     - Health check');
console.log('  - GET  /providers  - List available providers');
console.log('  - POST /chat       - Chat with AI models');
console.log('  - POST /chat/stream - Streaming chat (coming soon)');
