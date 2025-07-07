#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

// 业务文件扩展名（包含在统计中）
const BUSINESS_EXTENSIONS = new Set([
  '.ts', '.js', '.py', '.vue', '.tsx', '.jsx',
  '.json', '.yaml', '.yml', '.toml', '.jsonc',
  '.md', '.txt', '.sh', '.sql'
]);

// 排除的目录
const EXCLUDED_DIRS = new Set([
  'node_modules', '.git', '.nuxt', '.output', 'dist', 'build', '.next',
  '__pycache__', '.pytest_cache', 'coverage', '.venv', 'venv', 'env',
  '.backup', 'migrations', 'meta'
]);

// 排除的文件
const EXCLUDED_FILES = new Set([
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'uv.lock',
  '.DS_Store', 'Thumbs.db', '.png', '.jpg', '.jpeg', '.gif', '.ico', 
  '.svg', '.webp', '.zip', '.tar', '.gz', '.bz2', '.log', '.tmp', '.cache'
]);

// 项目模块配置
const PROJECT_MODULES = {
  'apps/backend': '后端服务 (Cloudflare Workers)',
  'apps/frontend': '前端应用 (Nuxt.js)',
  'apps/briefs': '简报生成 (Python)',
  'services/meridian-ai-worker': 'AI Worker 服务',
  'services/meridian-ml-service': 'ML 服务 (Python)',
  'packages/database': '数据库包',
  'docs': '项目文档',
  'scripts': '项目脚本'
};

class CodebaseAnalyzer {
  constructor() {
    this.stats = {
      totalFiles: 0,
      totalLines: 0,
      modules: {},
      fileTypes: {},
      excludedFiles: 0,
      excludedDirs: 0
    };
  }

  shouldExcludeDir(dirName) {
    return EXCLUDED_DIRS.has(dirName) || dirName.startsWith('.');
  }

  shouldExcludeFile(fileName, filePath) {
    if (EXCLUDED_FILES.has(fileName)) return true;
    
    const ext = path.extname(fileName);
    if (EXCLUDED_FILES.has(ext)) return true;
    if (!BUSINESS_EXTENSIONS.has(ext) && ext !== '') return true;
    if (fileName.includes('.min.') || fileName.includes('-lock')) return true;
    
    return false;
  }

  getFileType(filePath) {
    const ext = path.extname(filePath);
    const fileName = path.basename(filePath);
    
    if (fileName.includes('.test.') || fileName.includes('.spec.')) {
      return 'test';
    }
    
    const typeMap = {
      '.ts': 'typescript', '.tsx': 'typescript',
      '.js': 'javascript', '.jsx': 'javascript',
      '.py': 'python', '.vue': 'vue',
      '.json': 'config', '.jsonc': 'config', '.yaml': 'config', '.yml': 'config', '.toml': 'config',
      '.md': 'documentation', '.sql': 'database', '.sh': 'script'
    };
    
    return typeMap[ext] || 'other';
  }

  countLines(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return content.split('\n').filter(line => line.trim().length > 0).length;
    } catch (error) {
      console.warn(`无法读取文件: ${filePath}`);
      return 0;
    }
  }

  getModuleName(filePath) {
    const relativePath = path.relative(projectRoot, filePath);
    
    for (const [modulePath] of Object.entries(PROJECT_MODULES)) {
      if (relativePath.startsWith(modulePath)) {
        return modulePath;
      }
    }
    
    return relativePath.split('/')[0] || 'root';
  }

  analyzeDirectory(dirPath) {
    try {
      const items = fs.readdirSync(dirPath);
      
      for (const item of items) {
        const itemPath = path.join(dirPath, item);
        const stat = fs.statSync(itemPath);
        
        if (stat.isDirectory()) {
          if (this.shouldExcludeDir(item)) {
            this.stats.excludedDirs++;
            continue;
          }
          this.analyzeDirectory(itemPath);
        } else if (stat.isFile()) {
          if (this.shouldExcludeFile(item, itemPath)) {
            this.stats.excludedFiles++;
            continue;
          }
          
          const lines = this.countLines(itemPath);
          const fileType = this.getFileType(itemPath);
          const moduleName = this.getModuleName(itemPath);
          
          this.stats.totalFiles++;
          this.stats.totalLines += lines;
          
          // 按模块统计
          if (!this.stats.modules[moduleName]) {
            this.stats.modules[moduleName] = { files: 0, lines: 0 };
          }
          this.stats.modules[moduleName].files++;
          this.stats.modules[moduleName].lines += lines;
          
          // 按文件类型统计
          if (!this.stats.fileTypes[fileType]) {
            this.stats.fileTypes[fileType] = { files: 0, lines: 0 };
          }
          this.stats.fileTypes[fileType].files++;
          this.stats.fileTypes[fileType].lines += lines;
        }
      }
    } catch (error) {
      console.warn(`无法分析目录: ${dirPath}`);
    }
  }

  generateReport() {
    console.log('='.repeat(80));
    console.log('🚀 Meridian 项目代码库分析报告');
    console.log('='.repeat(80));
    console.log();

    // 总体统计
    console.log('📊 总体统计:');
    console.log(`   业务文件总数: ${this.stats.totalFiles.toLocaleString()}`);
    console.log(`   代码行数总计: ${this.stats.totalLines.toLocaleString()}`);
    console.log(`   排除的文件: ${this.stats.excludedFiles.toLocaleString()}`);
    console.log(`   排除的目录: ${this.stats.excludedDirs.toLocaleString()}`);
    console.log();

    // 按模块统计
    console.log('🏗️  模块分布:');
    const sortedModules = Object.entries(this.stats.modules)
      .sort(([,a], [,b]) => b.lines - a.lines);
    
    for (const [moduleName, moduleStats] of sortedModules) {
      const description = PROJECT_MODULES[moduleName] || '其他文件';
      const percentage = ((moduleStats.lines / this.stats.totalLines) * 100).toFixed(1);
      
      console.log(`   ${moduleName.padEnd(30)} | ${moduleStats.files.toString().padStart(4)} 文件 | ${moduleStats.lines.toString().padStart(6)} 行 | ${percentage.padStart(5)}%`);
      console.log(`   ${' '.repeat(30)} | ${description}`);
      console.log();
    }

    // 按文件类型统计
    console.log('📁 文件类型分布:');
    const sortedTypes = Object.entries(this.stats.fileTypes)
      .sort(([,a], [,b]) => b.lines - a.lines);
    
    for (const [fileType, typeStats] of sortedTypes) {
      const percentage = ((typeStats.lines / this.stats.totalLines) * 100).toFixed(1);
      console.log(`   ${fileType.padEnd(20)} | ${typeStats.files.toString().padStart(4)} 文件 | ${typeStats.lines.toString().padStart(6)} 行 | ${percentage.padStart(5)}%`);
    }
    
    console.log();
    console.log('='.repeat(80));
    console.log(`分析完成于: ${new Date().toLocaleString('zh-CN')}`);
    console.log('='.repeat(80));
  }

  run() {
    console.log('🔍 开始分析 Meridian 项目代码库...');
    console.log(`📂 项目根目录: ${projectRoot}`);
    console.log();
    
    this.analyzeDirectory(projectRoot);
    this.generateReport();
  }
}

// 运行分析
const analyzer = new CodebaseAnalyzer();
analyzer.run(); 