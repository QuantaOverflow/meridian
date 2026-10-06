/**
 * 「一次调用核查」各模块之间的接口约定（ADR 0012；spec 在本地 .scratch/one-call-sentence-check/）。
 * 只有类型，没有实现：取证、两条模型通道、核查本身分头实现，都照这里的签名。
 */
import type { CheckCluster, Verdict } from '../utils/sentence-check';
import type { SentenceItem } from '../prompts/sentenceCheck';
import type { ChatRequest, ChatResponse, CloudflareEnv } from '../types';
import type { TraceContext } from '../services/llm-call-logger';
import type { BriefBlockV6CheckFallbackReason } from '@meridian/contracts';

/** 簇里的一句原文，写成 `articleId:sentence` */
export type SentenceKey = string;

/**
 * 按意思搜要的向量，都已归一化。`sentences` 是整簇每一句；`queries` 以查询原文为键：
 * 要核查的那一句的全文，以及 `clausesOf` 切出的每个分句。缺某个查询的向量就跳过那一次按意思搜。
 */
export interface EvidenceEmbeddings {
  sentences: Map<SentenceKey, number[]>;
  queries: Map<string, number[]>;
}

/** 一句成稿的证据包：给模型看的原句，以及提示词里各分组要列的 key */
export interface EvidencePack {
  /** 要列出的全部原句，按发布时间从早到晚（同刻按 articleId、句号） */
  shown: SentenceKey[];
  /** 这句引用的、簇里确实有的原句 */
  cites: SentenceKey[];
  /** 搜索与数字时间线带进来、不在 cites 里的原句（去重，按取到的先后） */
  also: SentenceKey[];
  /** 与句中计数词数的是同一件事的原句，发布时间从早到晚；没有计数词就是空 */
  figures: SentenceKey[];
}

/** 把句子切成分句（规则见 spec「The evidence pack」第 3 条） */
export type ClausesOf = (text: string) => string[];

/** 纯函数：同样的输入得到同样的证据包。`embeddings` 为 null = 不按意思搜（向量没算出来） */
export type BuildEvidencePack = (
  cluster: CheckCluster,
  text: string,
  cited: SentenceKey[],
  embeddings: EvidenceEmbeddings | null
) => EvidencePack;

/** 一次调用核查的 system / user 提示词（逐字搬自 port-source 的 one-call.mts） */
export type OneCallPrompts = (item: SentenceItem, cluster: CheckCluster, date: string | null, pack: EvidencePack) => { system: string; user: string };

/**
 * 读回复：取 `RESULT` 行之后的 JSON；解不出就补一个右花括号再试一次。
 * 结论要有布尔的 `ok`；`ok: false` 的 evidence 只留簇里存在的句子。读不出 = null。
 */
export type ParseOneCallReply = (content: string, cluster: CheckCluster) => Verdict | null;

/** DashScope 通道抛的错。`kind` 决定回退原因；`unreadable` 不由通道抛（那是核查读回复时的判断） */
export interface DashScopeErrorShape extends Error {
  kind: Exclude<BriefBlockV6CheckFallbackReason, 'unreadable'>;
}

/**
 * DashScope 的一次 chat 调用（经 env.DASHSCOPE_BASE_URL）。限流 / 超时 / 5xx / 断连在通道里等待重发，用尽后抛 `provider_error`；
 * key 无效抛 `auth`，内容审核拒绝抛 `content_filter`，都不重试。返回的 `usage.neurons` 是按价目表折算的等价 neurons，
 * `usage.usd` 是美元原值。
 */
export type DashScopeChat = (env: CloudflareEnv, request: ChatRequest) => Promise<ChatResponse>;

/** 一批文本的向量（Workers AI bge-m3），已归一化，顺序同输入；调用记进观测与调用日志。失败重试用尽后抛错。 */
export type EmbedTexts = (ai: Ai, env: CloudflareEnv, trace: TraceContext, texts: string[]) => Promise<number[][]>;
