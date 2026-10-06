/**
 * 一次调用核查的回复读取（ADR 0012）：RESULT 行之后的 JSON；漏右花括号补一个再试；evidence 只留簇里确有的句子。
 */
import { describe, it, expect } from 'vitest';
import fixture from './fixtures/one-call-cluster.json';
import { clusterOf } from '../src/utils/sentence-check';
import { parseOneCallReply } from '../src/utils/one-call-reply';

const cluster = clusterOf(fixture.articles);
const CHECKS = 'CHECKS\nPart 1: "Sentence says: 57 people" / "Source [13:3] says: 57 people died in total." Same.\n';

describe('parseOneCallReply', () => {
  it('ok: true 的结论', () => {
    expect(parseOneCallReply(`${CHECKS}RESULT\n{"ok": true}`, cluster)).toEqual({ ok: true });
  });

  it('ok: false 的 flag，字段原样带出', () => {
    const reply = `${CHECKS}RESULT\n{"ok": false, "type": "number", "problem": "stale figure", "evidence": [[13, 3], [12, 1]], "fix": "The toll reached 57."}`;
    expect(parseOneCallReply(reply, cluster)).toEqual({
      ok: false,
      type: 'number',
      problem: 'stale figure',
      evidence: [
        [13, 3],
        [12, 1],
      ],
      fix: 'The toll reached 57.',
    });
  });

  it('漏了右花括号：补一个再试，读成它本来的 flag', () => {
    const reply = `${CHECKS}RESULT\n{"ok": false, "type": "number", "problem": "stale", "evidence": [[13, 3]], "fix": "x"`;
    expect(parseOneCallReply(reply, cluster)).toEqual({ ok: false, type: 'number', problem: 'stale', evidence: [[13, 3]], fix: 'x' });
  });

  it('没有 RESULT 行但有一个 JSON 对象：照读', () => {
    expect(parseOneCallReply('Looks fine.\n```json\n{"ok": true}\n```', cluster)).toEqual({ ok: true });
  });

  it('evidence 里指向簇里没有的句子：丢掉；一条都不剩，仍然是 flag，evidence 为空', () => {
    const reply = `RESULT\n{"ok": false, "type": "fabricated", "problem": "no source", "evidence": [[13, 3], [999, 1], [13, 40]], "fix": "y"}`;
    expect(parseOneCallReply(reply, cluster)).toEqual({ ok: false, type: 'fabricated', problem: 'no source', evidence: [[13, 3]], fix: 'y' });
    const none = `RESULT\n{"ok": false, "problem": "no source", "evidence": [[999, 1]]}`;
    expect(parseOneCallReply(none, cluster)).toEqual({ ok: false, problem: 'no source', evidence: [] });
    expect(parseOneCallReply(`RESULT\n{"ok": false}`, cluster)).toEqual({ ok: false, evidence: [] });
  });

  it('只有文字、没有 JSON，或 ok 不是布尔：读不出 = null', () => {
    expect(parseOneCallReply(`${CHECKS}RESULT\nThe sentence is fine.`, cluster)).toBeNull();
    expect(parseOneCallReply('RESULT\n{"ok": "yes"}', cluster)).toBeNull();
    expect(parseOneCallReply('', cluster)).toBeNull();
  });
});
