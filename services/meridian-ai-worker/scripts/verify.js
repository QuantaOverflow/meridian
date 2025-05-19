#!/usr/bin/env node

/**
 * 简单的验证脚本
 * 用于检查项目基本结构和依赖是否配置正确
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 检查目录和文件
function checkFiles() {
  const requiredFiles = [
    'package.json',
    'tsconfig.json',
    'wrangler.toml',
    'src/index.ts',
    'src/types.ts',
    'src/router/modelRouter.ts',
    'src/tasks/index.ts',
    'src/tasks/chatProcessor.ts'
  ];

  console.log('检查必要文件...');
  const missingFiles = [];
  
  for (const file of requiredFiles) {
    const filePath = path.join(__dirname, '..', file);
    if (!fs.existsSync(filePath)) {
      missingFiles.push(file);
    }
  }

  if (missingFiles.length > 0) {
    console.error('缺少以下文件:');
    missingFiles.forEach(file => console.error(`- ${file}`));
    return false;
  }

  console.log('✅ 所有必要文件都存在');
  return true;
}

// 检查依赖
function checkDependencies() {
  console.log('检查依赖...');
  
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  const dependencies = packageJson.dependencies || {};
  
  const requiredDeps = [
    'hono',
    'zod',
    '@hono/zod-validator',
    'openai',
    '@anthropic-ai/sdk',
    '@ai-sdk/google',
    '@cloudflare/ai'
  ];
  
  const missingDeps = [];
  
  for (const dep of requiredDeps) {
    if (!dependencies[dep]) {
      missingDeps.push(dep);
    }
  }
  
  if (missingDeps.length > 0) {
    console.error('缺少以下依赖:');
    missingDeps.forEach(dep => console.error(`- ${dep}`));
    return false;
  }
  
  console.log('✅ 所有必要依赖都已安装');
  return true;
}

// 验证 TypeScript 配置
function checkTsConfig() {
  console.log('验证 TypeScript 配置...');
  
  try {
    const result = execSync('npx tsc --noEmit', { stdio: 'pipe' });
    console.log('✅ TypeScript 检查通过');
    return true;
  } catch (error) {
    console.error('❌ TypeScript 检查失败');
    console.error(error.stdout.toString());
    return false;
  }
}

// 运行检查
function runChecks() {
  const filesOk = checkFiles();
  const depsOk = checkDependencies();
  
  console.log('\n============ 验证结果 ============');
  
  if (filesOk && depsOk) {
    console.log('✅ 基本检查通过');
    console.log('你可以使用以下命令运行项目:');
    console.log('  pnpm run dev     # 本地开发');
    console.log('  pnpm run deploy  # 部署到 Cloudflare Workers');
  } else {
    console.error('❌ 检查失败，请修复上述问题');
  }
}

runChecks();
