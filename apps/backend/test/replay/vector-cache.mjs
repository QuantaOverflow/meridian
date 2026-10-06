// 重放时句子向量的本地缓存。生产不存向量（一簇几 MB），录像里的向量调用只有条数；
// 重放跑的是真代码，替身照样收到每一批文本——缓存里有就答，没有就调一次真模型（Cloudflare REST API）
// 算出来存下，下次重放不再调。文件在这一期的 data/<wf>/vectors/ 下（gitignored），一批一个。
import fs from 'node:fs';
import path from 'node:path';
import { embedKey } from './lib.mjs';

const DEFAULT_API_BASE = 'https://api.cloudflare.com/client/v4';

export class VectorCache {
  /**
   * @param dir 缓存目录
   * @param apiBase Cloudflare REST API 的根地址；测试里指向本地假服务
   * @param token 要有 Workers AI 权限；空串 = 没有凭据，缓存里没有的批次直接报错
   */
  constructor(dir, { apiBase, accountId, token }) {
    this.dir = dir;
    this.apiBase = (apiBase || DEFAULT_API_BASE).replace(/\/+$/, '');
    this.accountId = accountId;
    this.token = token;
    this.hits = 0;
    this.computed = 0;
    this.failures = [];
    this.inFlight = new Map();
  }

  /** 一批文本的原始向量（binding 回包里的 data），顺序同输入。 */
  async get(model, texts) {
    const key = embedKey(model, texts);
    const file = path.join(this.dir, `${key}.json`);
    if (fs.existsSync(file)) {
      this.hits++;
      return JSON.parse(fs.readFileSync(file, 'utf8')).data;
    }
    // 同一批正在算：等那一次的结果，不重复调模型
    const pending = this.inFlight.get(key);
    if (pending) {
      const data = await pending;
      this.hits++;
      return data;
    }
    const p = this.compute(model, texts, file);
    this.inFlight.set(key, p);
    try {
      const data = await p;
      this.computed++;
      return data;
    } catch (e) {
      this.failures.push(e.message);
      throw e;
    } finally {
      this.inFlight.delete(key);
    }
  }

  async compute(model, texts, file) {
    if (!this.token) {
      throw new Error(
        '向量缓存里没有这一批，又没有凭据去现算：设 CLOUDFLARE_API_TOKEN（环境变量、test/replay/.replay.env 或 apps/backend/.dev.vars），'
        + 'token 要有 Workers AI 权限（只读 R2 的那个不够）',
      );
    }
    const url = `${this.apiBase}/accounts/${this.accountId}/ai/run/${model}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', Authorization: `Bearer ${this.token}` },
      body: JSON.stringify({ text: texts }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) {
      const detail = (body?.errors ?? []).map((e) => e.message).join('; ');
      const hint = res.status === 401 || res.status === 403 ? '——CLOUDFLARE_API_TOKEN 要有 Workers AI 权限' : '';
      throw new Error(`现算向量失败：HTTP ${res.status} ${detail}${hint}`);
    }
    const data = body.result?.data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new Error(`现算向量失败：${model} 回的向量条数不对，要 ${texts.length} 条，回 ${Array.isArray(data) ? data.length : '非数组'}`);
    }
    fs.mkdirSync(this.dir, { recursive: true });
    // 先写临时文件再改名：跑到一半被杀不会留下半个文件
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ model, texts, data }));
    fs.renameSync(tmp, file);
    return data;
  }

  /** 报告里的一行。 */
  summary() {
    return `向量调用 ${this.hits + this.computed} 批：缓存作答 ${this.hits} 批，现算 ${this.computed} 批（调了真模型 ${this.computed} 次）`
      + (this.failures.length ? `，失败 ${this.failures.length} 批` : '');
  }
}
