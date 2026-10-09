/**
 * 端到端测试共用的一份构建：vitest 的 globalSetup 在所有测试文件之前构建一次（node-server preset），
 * 各文件的 `setup()` 展开 `builtSite`，只起服务、不再各自构建（原来每个文件构建一次，约 20 秒）。
 * 各文件不同的只有传给服务进程的环境变量，那些都是运行时读的，不进构建产物。
 *
 * 构建放在子进程里：直接在 vitest 主进程里调 buildNuxt，构建完进程会以退出码 0 结束、一个测试都不跑。
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const buildDir = fileURLToPath(new URL('../.nuxt/test/shared', import.meta.url));
const nuxtConfig = { buildDir, nitro: { preset: 'node-server', output: { dir: `${buildDir}/output` } } };

/** 展开进 `setup()` 的参数 */
export const builtSite = { rootDir, build: false, buildDir, nuxtConfig };

const BUILD = `
import { buildNuxt, loadNuxt } from 'nuxt/kit';
const nuxt = await loadNuxt({ cwd: process.argv[1], dev: false, overrides: JSON.parse(process.argv[2]) });
await buildNuxt(nuxt);
await nuxt.close();
`;

export default async function globalSetup() {
  await rm(buildDir, { recursive: true, force: true });
  await promisify(execFile)(process.execPath, ['--input-type=module', '-e', BUILD, rootDir, JSON.stringify(nuxtConfig)], {
    cwd: rootDir,
    maxBuffer: 64 * 1024 * 1024,
  });
  const entry = `${buildDir}/output/server/index.mjs`;
  if (!existsSync(entry)) throw new Error(`构建结束但没有产物：${entry}`);
  return () => rm(buildDir, { recursive: true, force: true });
}
