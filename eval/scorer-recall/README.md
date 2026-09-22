# scorer-recall —— 量**判官看不看得见错误**

`cluster-to-brief` 量的是「哪个 solver 写得好」。这个 harness 量的是上一句里那把尺本身:

> 给定一句成稿 + 检索来的证据,判官能认出其中多少条真的事实错?误拦多少?

## 为什么需要它

2026-09-19 修完 `cluster-to-brief` 的证据通道之后,**fatal / hard 在所有测过的簇上全是 0**。
这不代表简报没有事实错 —— 而是那把尺的 grading instructions 里明写着一条:

> 判不准的归属类错误标 `ok`,不要硬猜。

而归属类错误(施事/引语/角色搬错)占自然错误的 **60%**。也就是说,这把尺被明确要求
在最常见的那类错误上往「没问题」判。**「硬错 0」是下界,不是实数。**

先量 operating point,再谈改不改守则。没有这个数,任何对守则的改动都是盲调。

## 材料:自然金标,不是注入题

`gold/natural-errors.jsonl` —— 15 条,来自 2026-09-18 的逐句手工标注
(`cluster-to-brief/out/natural-error-rate/NATURAL-ERROR-RATE-RESULT.md`,本地):
82 句自然生成的候选句里 15 句含事实错(18.3%)。

形状:

| 类别 | 自然(n=15) | 人工注入(n=60,配平) |
|---|---|---|
| **actor**(施事/归属/角色/论元互换) | **9(60%)** | 12(20%) |
| **time**(日期/时序/先后颠倒) | **3(20%)** | **0 —— 注入体系里无此类** |
| quantity | 1(6.7%) | 12(20%) |
| state(计划 vs 完成) | 1(6.7%) | 12(20%) |
| epistemic(单方声称写成既成事实) | 1(6.7%) | **0 —— 注入体系里无此类** |
| polarity | **0** | 12(20%) |
| scope | **0** | 12(20%) |

**所以不造注入题。** 三条理由,全部来自那次实测:

1. polarity 与 scope 在 83 句自然候选里**一条都没出现** —— 写作模型不会把 did 写成 did not。
   用它们占掉 40% 的验收材料,等于把 40% 预算花在不存在的形状上。
2. 占自然 20% 的**时序错在注入体系里连类别都没有**,而它后果最重
   (「拆除令在倒塌前下达」直接反转问责叙事)。
3. 自然的 actor 错 **6/9 是「两条各自正确的事实被融成一句、把 A 的谓语挂到 B 头上」**,
   单点替换造不出这个形状。

结论写死在那份文档里:**在注入题上测出的召回不可外推到生产流量。**

## 检测上限

金标 #2(`Jamieson Greer ... what **she** called`)是真实世界事实错 —— 原文自始至终只写
"Greer said",没有任何代词。**只对照本簇原文推不翻这一条。** 所以召回上限是 14/15 = 93.3%,
`score-recall.mjs` 会把这条单列。

## 语料

**不能用 `cluster-to-brief/fixtures/`。** 那 296 篇是 2026-09-13 之后的快照(id 98xxxx–100xxxx),
与金标所在的 M2 run 语料(id 90xxxx–92xxxx)**完全不重叠**,簇号体系也不同。
原文取自 `apps/backend/prototypes/brief-v3-prod/out/raw/<c>/{A,B,C}/batch*.json`
(`map` 给 `(articleId, 句号)` 坐标,`flat` 给正文),`corpus.mjs` 负责重建。

**这是本地原型目录,不在 git 里。** 机器上没有它,这个 harness 跑不了 —— 只有 `gold/` 和脚本入库。

## 金标按文本定位,不按句号

生产那条流水线的 splitter 与 `lib.mjs` 的 `splitSentences` **不同构**:c0-lead production 切 14 句、
我们切 13 句(`."  He argued…` 这个边界两边判断不同),编号整体差一位。
按句号对金标会指到**相邻句**上,而且不报错。所以 `gold` 每条带 `match` 文本,
`score-recall.mjs` 断言每条在该 block 内唯一命中,不唯一就 exit 2。

## 跑

```bash
# 1. 组装判定包(零远程调用,本地 e5-small 检索)
node build-pack.mjs                     # 12 个 block / 82 句
node build-pack.mjs --variant=actor     # 换一版 grading instructions(单变量对照)

# 2. 判官读 out/<variant>/pack-<block>.md,判定写进 out/<variant>/<judge>/verdict-<block>.json

# 3. 算召回与精确率
node score-recall.mjs --verdicts=out/base/judgeA
```

`--variant` 只动 grading instructions 里被标出的那一段,档表、证据范围、"先核事实再读文风"
全部不动 —— **改多于一处就不是单变量,测出来的差不知道该归给谁。**

- `base`:与 `cluster-to-brief/build-judge-pack.mjs` 逐字同源(含"判不准标 ok"那条)
- `actor`:把"宁可漏报"换成一道必做的四项归属核对(施事 / 时间挂靠 / 两条事实融合 / 声称 vs 事实)

## 已知边界

- **精确率是下界,不是误拦率。** 原始标注里另有 10 句「措辞有损但读者不会形成假信念」的临界句,
  当时没落成机器可读的清单。判官报出的非金标句里可能混着临界句。要把精确率当真,
  得先把那 10 句补标进 `gold/`。
- **样本量 82 句 / 4 个簇。** 召回的置信区间很宽,只够分辨大的差别,分辨不了几个百分点。
- **这里的成稿来自 `brief-v3-prod` 的 M2 run**,不是 `cluster-to-brief` 的任何一个臂。
  测的是判官,不是某个 solver。
