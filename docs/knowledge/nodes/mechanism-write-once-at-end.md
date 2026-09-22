---
{
  "id": "mechanism-write-once-at-end",
  "type": "mechanism",
  "title": "改写只发生一次,且发生在看得见全局的最后一步",
  "date": "2026-09-20",
  "status": "candidate",
  "tasks": ["演化组合架构", "治事实关系错"],
  "scope": "direct-raw exec 臂;窗口 30k 字符、每窗最多 12 条重点、每条最多 4 个出处;glm-4.7-flash",
  "source": "eval/cluster-to-brief/arms/direct-raw/direct-raw.mjs(DIRECT_RAW_WRITE_AT_END)",
  "conditions": ["簇内全量原文可读,不做 30 篇截断", "窗口步与写作步用同一个模型"],
  "evidence_origin": "local_record",
  "relations": [
    {"type": "justified_by", "to": "lesson-run-variance-needs-epochs"}
  ],
  "input": "一个簇的全量原文,逐句编号",
  "output": "一块正文(3–5 句高管简报)+ 每句的出处句编号;或 not_a_single_event + 理由",
  "limits": "窗口步每条重点最多引 4 篇,报道篇数到 4 就封顶,4 篇与 20 篇的事看起来一样重;跨窗口的同一件事不会合并计数;必写档只取最高一档时,一篇之差就能让一整条线掉出简报(实测 c28 营救线 0/3);写作步仍会编造关系与消息源(读者可见错 6.5%)",
  "invalidates_when": "改成两遍写(写完再核)后,读者可见错率不降或覆盖明显下降"
}
---

**替换的旧做法**:窗口步各写各的句子,最后一步只挑不改。那样成稿是十来次调用的句子拼接,
没有主次也没有过渡,用户读后判定为「结构化信息汇编」,不是简报。

**为什么放在最后**:写作需要全局视野(谁是主线、什么该压缩),而窗口步天然只看得到一个窗口。
把改写挪到最后一步之后,同一批材料写出来的是连贯的一段。

**为什么只写一次**:每多一次转述就多一层失真。前面的步骤只标「哪几句重要」,
写作层直接读原句——这避开了已证伪的「级间传代理」。

**配套**:`mechanism-citation-repair` 修出处;按报道量排序并标必写(限制见上)。
