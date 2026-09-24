/**
 * runner：把「跑哪些样本、数据从哪来、产物落哪、花了多少」从臂里抽出来。
 *
 * 臂（solver）只回答一件事：给定一个 sample，写出简报。它不该知道数据是 fixtures 还是某份
 * dataset、不该知道 DEV 白名单、不该自己记消耗——每加一个臂就把这三件事重抄一遍，
 * 改一处要改四处。判据：臂的源码里搜不到 dataset / fixtures / DEV / recordConsumption 这些词。
 *
 * 职责边界（CONTRACTS.md 第 2 节写了同一份）：
 *   runner  范围选择、两种数据来源、两道闸（DEV/ALLOW_HELDOUT、FULL_RUN_MAX/--all）、
 *           产物根目录、正文加载、消耗记账
 *   臂      窗口切分、抽重点、写正文、窗口缓存与 --resume（产物根目录下怎么摆是它的事）
 *
 * 现状：只剩 arms/direct-raw 一个臂（structure-router / atomic-evidence / evidence-graph 已删）。
 */
import { loadCluster, OUT_ROOT } from './lib.mjs';
import { loadDataset, loadClusterFrom, datasetClusters, sampleView, recordConsumption } from './dataset.mjs';

// fixtures 的 dev 簇白名单。heldout(28/51)是一次性资源:跑过之后对本臂不再是「未见过的数据」,
// 再看结果回去调就是过拟合。要跑必须显式 ALLOW_HELDOUT=1,让这个动作在命令行里留痕。
const DEV = [7, 1, 36, 37, 43];
// dataset 模式跑多少簇以内不用确认开关(fixtures 模式不受影响,它有 DEV 白名单 + ALLOW_HELDOUT)
const FULL_RUN_MAX = 3;

export function argsOf(argv) {
  return Object.fromEntries(argv.map(x => {
    const m = /^--([^=]+)=?(.*)$/.exec(x);
    return m ? [m[1], m[2] === '' ? true : m[2]] : [x, true];
  }));
}

/**
 * fixtures 模式的一个 sample。形状与 `sampleView` 一致，只是没有标注：
 * fixtures 层没有 labels，target 给 null，别拿 {} 冒充「标注是空的」。
 */
function fixtureSample(clusterId) {
  const cluster = loadCluster(clusterId);
  return {
    id: `c${clusterId}`,
    input: { clusterId: Number(clusterId), articleIds: cluster.articles.map(a => a.id), cluster },
    target: null,
    metadata: {},
  };
}

/**
 * 跑一个臂。
 *
 * @param {{meta: {name: string, consumerId: () => string, resolveOutDir?: (base: string) => string,
 *          runSample: (sample: object, options: object) => Promise<void>}} arm
 * @param {string[]} [argv]  默认 process.argv.slice(2)
 * @returns {Promise<{ids: number[], outDir: string}>}  跑了哪些簇、产物根目录（臂收尾打印用）
 */
export async function runArm(arm, argv = process.argv.slice(2)) {
  const args = argsOf(argv);
  // `--dataset` 不带值（argsOf 给 true）当没传——与抽出 runner 之前的 startsWith('--dataset=') 同义。
  const datasetId = typeof args.dataset === 'string' && args.dataset ? args.dataset : null;
  // dataset 模式：簇与文章从 dataset 层取（datasets/<id>.json + out/_data/<id>/content/），
  // 不传则一切照旧走 lib.mjs 的 loadCluster 读 fixtures/。
  const ds = datasetId ? loadDataset(datasetId) : null;
  // 产物按 dataset 分目录，否则新数据的簇号会撞上 fixtures-r94 的同名历史产物，
  // 把不可比的两套读数写进同一个文件。fixtures 模式不加后缀，路径一个字不变。
  const outDir = `${OUT_ROOT}${arm.meta.name}${ds ? `-${ds.id}` : ''}`;

  const ids = args.cluster ? [Number(args.cluster)] : ds ? datasetClusters(ds) : DEV;
  if (!ds) {
    const offDev = ids.filter(c => !DEV.includes(c));
    if (!ids.length || (offDev.length && process.env.ALLOW_HELDOUT !== '1')) throw new Error(`c${offDev.join(',')} 不在 dev 内。要跑 heldout 加 ALLOW_HELDOUT=1(一次性资源,想清楚再跑)。`);
    if (offDev.length) console.error(`⚠️ 正在消耗 heldout: ${offDev.map(c => 'c' + c).join(',')}`);
  } else {
    // dataset 模式：DEV 白名单与 ALLOW_HELDOUT 都不适用——新 dataset 是**整份**划 dev/holdout 的,
    // 簇级白名单(写死 fixtures 的簇号)在这个结构下没有意义,消耗改由 dataset 自己的 consumed 记。
    //
    // 不带 --cluster 就是跑整份 —— 默认语义不变。但「整份」在新 dataset 上是 47 簇,
    // 每簇多次 LLM 调用,是真实开销;顺手敲一行命令和决定花这笔钱之间没有任何区别。
    // 所以超过 FULL_RUN_MAX 簇要显式加开关,让这个决定在命令行里留痕。
    // --plan 也一并拦:拦的是「有没有想清楚跑多大」,不是「这次花不花钱」——
    // 两套口径会让开关在 --plan 下验不到,于是没人验过它到底拦不拦得住。
    if (ids.length > FULL_RUN_MAX && !args.all && process.env.ALLOW_FULL_RUN !== '1') {
      throw new Error(
        `dataset ${ds.id} 有 ${ids.length} 簇,一次跑完 = ${ids.length} 簇 × 每簇多次 LLM 调用的真实开销。\n` +
          `  确认要全跑:加 --all(或 ALLOW_FULL_RUN=1)\n` +
          `  只跑一簇:  --cluster=<簇号>\n` +
          `  ≤${FULL_RUN_MAX} 簇不需要开关。`
      );
    }
    console.log(`dataset ${ds.id}: ${ids.length}/${datasetClusters(ds).length} 簇 -> ${arm.meta.resolveOutDir?.(outDir) ?? outDir}`);
  }

  // 视图先切好（点名了不存在的簇在这里当场炸），正文仍逐簇按需读：
  // 一簇读完跑完再读下一簇，跑到一半挂掉时已跑的那几簇产物照样在盘上。
  const samples = ds ? sampleView(ds, { scope: { clusters: ids } }) : null;
  const options = { plan: !!args.plan, resume: !!args.resume, outDir };
  for (const [i, cid] of ids.entries()) {
    const sample = ds
      ? { ...samples[i], input: { ...samples[i].input, cluster: loadClusterFrom(ds, cid) } }
      : fixtureSample(cid);
    await arm.runSample(sample, options);
  }

  // --plan 不进生成、不看任何输出,不算消耗;真跑过才记一条。
  if (ds && !args.plan) {
    const rows = recordConsumption(ds.id, { by: arm.meta.consumerId(), note: `跑了 ${ids.map(c => `c${c}`).join(',')}` });
    console.log(`consumed += 1（${ds.id} 现有 ${rows.length} 条）`);
  }
  return { ids, outDir };
}
