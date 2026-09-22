---
{
  "id": "measure-checklist-core-audit",
  "type": "lesson",
  "title": "核心层 21 条双模型校核:6 条内容有错、15 条丢了口径分歧;sonnet 零误报但漏 2 条综合判断题",
  "date": "2026-09-19",
  "status": "recorded",
  "tasks": ["设计验收门"],
  "scope": "dev 五簇的核心层 21 条(占清单 141 条的 14.9%);次层 24 条与尾层 96 条未校核",
  "source": "eval/cluster-to-brief/{audit-checklist.mjs,apply-audit.mjs,compare-audits.mjs} 与 out/_checklist-audit/",
  "conditions": [
    "两个校核者读同一份证据包(全簇检索 top-6 + 每篇支持文章各自最匹配的一句),互不可见",
    "唯一变量是模型(opus / sonnet),指令逐字相同",
    "校核只查「清单写得对不对」,查不到「该有而没抽到」与「支持篇数算错导致的错误分层」"
  ],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "cautions", "to": "mechanism-checklist-tiering", "attributes": {"scope": "核心层内容已校核并修正,分层与完整性仍未验"}}
  ],
  "kind": "observation",
  "invalidates_when": "重抽清单、或把校核扩到次层之后重测"
}
---

## 清单的错

21 条里 **6 条判 wrong**(4 条两个校核者都判、2 条只有 opus 判),**15 条(71%)丢了口径分歧**。

错的形状:

| 类型 | 条数 | 例 |
|---|---|---|
| 剥掉消息源 | 3 | c36#6 把 CENTCOM 在 X 上的单方表态写成事实,而它正对着 IRGC「触雷」的相反说法 |
| 施事/地点搬错 | 2 | c36#1 把 Iran-Gulf 会议写成 Iraq(只有一句疑似源文笔误这么写,其余六句全是 Iran);c36#3 凭空加了地名 Salalah,原文两处都是 Muscat |
| 删掉时点限定 | 1 | c1#3 原句是「计票 92% 时 175–174」,清单删掉限定,与同清单 #6(95% 时 176–173)**自相矛盾** |

**6 条里 3 条是剥掉消息源** —— 正是同一天刚给成稿补上的那条守则。
基准自己在犯它要求成稿不许犯的错,见 [[lesson-source-stripping-undetected]]。

## 口径分歧

15 条:瑞典民主党得票 17.5%/17.6%/just under 18%、席位 175–174(92%)/176–173(95%)、
输油管关停 Friday/Thursday、占领 Perim Friday/Sunday、伤者四人/三人、
西岸死亡 1,107/1,087、泰国外长姓氏两个拼法……

**清单锁死一个,成稿写了另一个(各有独立出处)就被判没命中 —— 罚的是它没做错的事。**
已加 `variants` 字段并改判官守则:写了其中任一个都算命中。

## opus vs sonnet

| | opus | sonnet |
|---|---|---|
| verdict 一致 | 19/21 = 90.5% | |
| 判 wrong | 6 | 4 |
| 漏判 | — | 2 |
| **误报** | — | **0** |

sonnet 漏的两条形状一致,**都要跨多条证据做综合判断**:
c36#1 要比较七句证据并认定其中一句是源文笔误(多数决);
c1#3 要发现 #3 与 #6 是同一事实的两个计票快照、互相矛盾(跨条目一致性)。

两条 sonnet 都记成了「口径冲突」而不是 wrong —— **它看见了,只是判得保守**。

**可操作**:逐句对照类的判官活,sonnet 够用(零误报,今天判官约 180 万 token,降档省一大截);
跨条目综合判断留给 opus。
