#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const fixturesDir = path.join(__dirname, '../test/fixtures');
const outputFile = path.join(__dirname, '../test/fixtures.ts');

// 读取所有 XML 文件
const files = fs.readdirSync(fixturesDir).filter(file => file.endsWith('.xml'));

let output = `// Auto-generated fixtures file
// Run 'npm run generate-fixtures' to regenerate this file

export const fixtures = {
`;

files.forEach(file => {
  const content = fs.readFileSync(path.join(fixturesDir, file), 'utf-8');
  const fixtureKey = file.replace('.xml', '').replace(/[^a-zA-Z0-9]/g, '_');
  
  // 转义反斜杠和反引号
  const escapedContent = content
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\${/g, '\\${');
  
  output += `  ${fixtureKey}: \`${escapedContent}\`,\n\n`;
});

output += `} as const;

export type FixtureKey = keyof typeof fixtures;
`;

fs.writeFileSync(outputFile, output, 'utf-8');
console.log(`Generated fixtures for ${files.length} files: ${files.join(', ')}`); 