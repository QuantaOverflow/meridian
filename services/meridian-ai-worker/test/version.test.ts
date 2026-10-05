// @vitest-environment node
/**
 * GET /meridian/version：ai-worker 报自己跑的是哪个提交（运维台经 backend 的 AI_WORKER binding 读）。
 * 走真实 Hono 路由，只给假的 env：提交三项是 scripts/deploy.sh 部署时注入的变量，版本 id 与部署时刻来自
 * version metadata binding。
 */
import { describe, expect, it } from 'vitest'
import app from '../src/index'

async function version(env: object) {
  const res = await app.request('/meridian/version', {}, env)
  return { status: res.status, body: await res.json() as any }
}

describe('GET /meridian/version', () => {
  it('经部署脚本部署：提交、标题、dirty、部署时刻、版本 id', async () => {
    const { status, body } = await version({
      GIT_COMMIT: '13db6c7',
      GIT_TITLE: 'feat(ops): 运维台的接口约定: a, b',
      GIT_DIRTY: 'false',
      CF_VERSION_METADATA: { id: 'a5f9abc7-0000-4000-8000-000000000001', tag: '13db6c7', timestamp: '2026-10-05T12:00:00.000Z' },
    })

    expect(status).toBe(200)
    expect(body).toEqual({
      success: true,
      data: {
        service: 'ai-worker',
        commit: '13db6c7',
        title: 'feat(ops): 运维台的接口约定: a, b',
        dirty: false,
        deployedAt: '2026-10-05T12:00:00.000Z',
        versionId: 'a5f9abc7-0000-4000-8000-000000000001',
        health: 'healthy',
      },
    })
  })

  it('工作区有未提交改动时部署：dirty 为 true', async () => {
    const { body } = await version({ GIT_COMMIT: '13db6c7', GIT_TITLE: 't', GIT_DIRTY: 'true' })
    expect(body.data.dirty).toBe(true)
  })

  it('没经部署脚本（变量与 binding 都没有）：各项为 null，仍是 healthy', async () => {
    const { status, body } = await version({})

    expect(status).toBe(200)
    expect(body.data).toEqual({
      service: 'ai-worker',
      commit: null,
      title: null,
      dirty: null,
      deployedAt: null,
      versionId: null,
      health: 'healthy',
    })
  })
})
