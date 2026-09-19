import test from 'node:test';
import assert from 'node:assert/strict';
import { filterGrounded, ungroundedTermsAgainst, materialFromText } from './local-grounding.mjs';

const src = {
  '1:1': 'Brent crude rose 2.1% on Tuesday after the strike.',
  '1:2': 'Houthi forces said they downed three Saudi drones over al-Jawf.',
  '1:3': 'The inspector said Operation Epic Fury cost $33.4 billion in total.',
};
const resolve = (a, s) => src[`${a}:${s}`];
const cand = (id, text, refs) => ({ id, topic: 't', text, sources: refs.map(r => ({ articleId: +r.split(':')[0], sentence: +r.split(':')[1] })) });

test('引句支持的候选留下', () => {
  const { kept, dropped } = filterGrounded([cand('a', 'Houthi forces downed three Saudi drones over al-Jawf.', ['1:2'])], resolve);
  assert.equal(kept.length, 1);
  assert.equal(dropped.length, 0);
});

test('专名不在引句里 —— 丢弃（c36 的 b2s8 形状：多出来源国）', () => {
  const { kept, dropped } = filterGrounded([cand('b', 'The pipeline was shut by a drone launched from Iraq.', ['1:1'])], resolve);
  assert.equal(kept.length, 0);
  assert.ok(dropped[0].ungrounded.includes('Iraq'));
});

test('数字不在引句里 —— 丢弃（b2s6 形状：凭空的量）', () => {
  const { dropped } = filterGrounded([cand('c', 'Yanbu held about 35 million barrels.', ['1:3'])], resolve);
  assert.ok(dropped[0].ungrounded.includes('35'));
});

test('把两件事接起来，而引句只支持一件 —— 丢弃（b2s4 形状）', () => {
  const { dropped } = filterGrounded([cand('d', 'The move followed Houthi strikes on Saudi Arabia.', ['1:1'])], resolve);
  assert.deepEqual(new Set(dropped[0].ungrounded), new Set(['Houthi', 'Saudi', 'Arabia']));
});

test('引多句时合并成一份语料', () => {
  const { kept } = filterGrounded([cand('e', 'Houthi forces downed Saudi drones as Brent crude rose.', ['1:1', '1:2'])], resolve);
  assert.equal(kept.length, 1);
});

test('千分位与复数变体不算未接地', () => {
  const m = materialFromText('The deal covered 33,400 barrels for Houthi fighters.');
  assert.deepEqual(ungroundedTermsAgainst(m, 'It covered 33,400 barrels for the Houthis.'), []);
});

test('句首词跳过，不把开头的大写词当专名', () => {
  const m = materialFromText('rose two percent');
  assert.deepEqual(ungroundedTermsAgainst(m, 'Prices rose two percent.'), []);
});
