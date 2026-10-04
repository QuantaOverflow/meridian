// @vitest-environment node
/**
 * 简报块 v6 集成测试：真实原文 → 切句 → 标重点 → 写作 → 补出处，走真实 BriefBlockV6Service，
 * 只假 Workers AI binding（与 R2 写观测）。假模型按 prompt 里的原文内容找句子编号，
 * 复现生产里的失败方式：把卢比奥的话挂到 Wicker 那句上。
 *
 * 原文是 2026-09-24 期（report 105）第 1 块簇里文章 1117820 的一小段，原样截取
 * （抓取时段落换行已丢，引语后紧跟下一句、小标题黏进正文都是原貌）。
 * 旧切句下，Wicker 的两段话、小标题和卢比奥的原话全在同一个编号底下；
 * 写作把卢比奥的话挂到那一大句上，读者点开出处看到的是一整段黏连文字。
 */
import { describe, expect, it, vi } from "vitest"
import { BriefBlockV6Service } from "../src/services/brief-block-v6"

const CONTENT = "Wicker criticises 'lavish welcome'The ceremonial reception has also drawn criticism from within the US. Sen. Roger Wicker, the Republican chairman of the Senate Armed Services Committee, criticised the “lavish welcome” for Xi. Wicker said during a speech in the Senate on Tuesday that Trump should not have invited the Chinese leader “based on all of the troubling issues we have with President Xi and the Chinese Communist Party.”Wicker suggested that Trump could use the state dinner to discuss issues including “the purposes of China’s massive military buildup, or about China’s clear support for Iran.”He also said that “during every minute of dialogue” Trump should keep in mind that “his guest is a brutal, unelected and oppressive dictator who seeks to dominate his neighbors and whose massive military arsenal is aimed directly at the United States of America.”Rubio says US must engage China at highest levelsUS Secretary of State Marco Rubio defended the need for high-level engagement with Beijing, saying the United States and China are “the two largest economies in the world” and “probably the two most powerful militaries in the world.”“The idea that we would not interact with them at the highest levels is irresponsible. It’s outrageous. We have to,” Rubio told reporters Wednesday while he was in New York. The administration has presented the engagement as part of efforts to maintain strategic stability between the two countries despite their disagreements."

const ID = 1117820
const RUBIO_CLAIM =
  "US Secretary of State Marco Rubio defended the need for high-level engagement with Beijing, stating that the two countries are the world's largest economies and most powerful militaries."

/** prompt 里带编号的原句：[articleId:n] text */
function labeled(prompt: string): Array<{ n: number; text: string }> {
  return [...prompt.matchAll(new RegExp(`^\\[${ID}:(\\d+)\\] (.*)$`, "gm"))].map(m => ({ n: Number(m[1]), text: m[2] }))
}
function labelOf(prompt: string, fragment: string): number {
  const hit = labeled(prompt).find(s => s.text.includes(fragment))
  if (!hit) throw new Error(`prompt 里没有含「${fragment}」的原句`)
  return hit.n
}

function fakeEnv() {
  const prompts: string[] = []
  const AI = {
    run: vi.fn(async (_model: string, inputs: Record<string, any>) => {
      const prompt = inputs.messages[0].content as string
      prompts.push(prompt)
      const wicker = labelOf(prompt, "Wicker said during a speech")
      const rubio = labelOf(prompt, "Marco Rubio defended")
      const body = prompt.includes("<material>")
        ? {
            verdict: "written", reason: "one event", title: "Rubio defends engagement with Beijing",
            // 生产里的失败：卢比奥的话挂在 Wicker 那句上
            sentences: [{ text: RUBIO_CLAIM, sources: [{ articleId: ID, sentence: wicker }] }],
          }
        : {
            anchors: [
              { topic: "Wicker criticises welcome", sources: [{ articleId: ID, sentence: wicker }] },
              { topic: "Rubio defends engagement", sources: [{ articleId: ID, sentence: rubio }] },
            ],
          }
      return { choices: [{ message: { content: JSON.stringify(body) }, finish_reason: "stop" }], usage: { completion_tokens: 1, neurons: 1 } }
    }),
  } as unknown as Ai
  const ARTICLES_BUCKET = { put: vi.fn(async () => {}) } as unknown as R2Bucket
  // 只测切句与补出处：关掉逐句核查与改写（BRIEF_CHECK_EPOCHS=0）
  return { env: { AI, ARTICLES_BUCKET, BRIEF_CHECK_EPOCHS: "0" }, prompts }
}

describe("brief-block-v6 集成：真实原文上的切句与补出处", () => {
  it("引语后黏着的下一句被切开；挂偏的出处补上卢比奥那句", async () => {
    const f = fakeEnv()
    const svc = new BriefBlockV6Service(f.env, f.env.AI, { traceId: "trace-int", callIndex: 0 })
    const r = await svc.generate({
      articles: [{ id: ID, title: "Xi arrives in Washington", content: CONTENT, publishDate: "2026-09-24" }],
      tier: "brief",
    })

    // 1. 切句：Wicker 第一段话在右引号处收尾，下一段话另起一个编号
    const anchorPrompt = f.prompts.find(p => !p.includes("<material>"))!
    const texts = labeled(anchorPrompt).map(s => s.text)
    expect(texts).toContain(
      "Wicker said during a speech in the Senate on Tuesday that Trump should not have invited the Chinese leader “based on all of the troubling issues we have with President Xi and the Chinese Communist Party.”"
    )
    expect(texts.some(t => t.startsWith("Wicker suggested that Trump could use the state dinner"))).toBe(true)

    // 2. 补出处：最终出处里有卢比奥原话那句，原来挂的 Wicker 句保留（只补不删）
    const writePrompt = f.prompts.find(p => p.includes("<material>"))!
    const rubio = labelOf(writePrompt, "Marco Rubio defended")
    const wicker = labelOf(writePrompt, "Wicker said during a speech")
    expect(r.verdict).toBe("written")
    expect(r.block!.sentences[0].sources).toEqual([
      { articleId: ID, sentence: wicker },
      { articleId: ID, sentence: rubio },
    ])
    expect(r.trace.citationsRepaired).toBe(1)
  })
})
