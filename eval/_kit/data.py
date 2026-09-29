"""原型与 eval 共用的数据入口：金标、故事快照、故事向量、代表文章正文。

本地缓存都落 `eval/_kit/.cache/`（eval/.gitignore 已挡）。金标本身在 `eval/_data/<set>/`（入 git）。

需要的环境：
- 生产库：环境变量 DATABASE_URL（Neon 连接串；从 Neon 控制台或 Neon MCP 的 get_connection_string 取，
  只放环境变量，**不写进任何文件**）。本机连新加坡库每条查询约 0.4 秒，所以这里一律一次批量取。
- R2 正文：本机 wrangler 已登录（`npx wrangler login`）。
"""
import json, os, subprocess
from concurrent.futures import ThreadPoolExecutor

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(REPO, 'eval', '_data')
CACHE = os.path.join(REPO, 'eval', '_kit', '.cache')
AI_WORKER_DIR = os.path.join(REPO, 'services', 'meridian-ai-worker')
R2_BUCKET = 'meridian-articles-prod'


# ---------- 金标 ----------

def load_gold(set_id):
    """读 eval/_data/<set_id>/labels.jsonl → {story_id: 行}。行里有 period / split / line / unsure。"""
    rows = [json.loads(l) for l in open(os.path.join(DATA, set_id, 'labels.jsonl'))]
    return {r['story_id']: r for r in rows}


def load_evidence(set_id):
    """读金标包的证据快照 → {story_id: 故事}（标题、代表文章、事件要点、实体、发布时间）。"""
    rows = [json.loads(l) for l in open(os.path.join(DATA, set_id, 'evidence.jsonl'))]
    return {r['story_id']: r for r in rows}


# ---------- 生产库 ----------

def _psql_json(sql):
    url = os.environ.get('DATABASE_URL')
    if not url:
        raise SystemExit('缺 DATABASE_URL：从 Neon 取生产连接串放进环境变量（不要写进文件）')
    out = subprocess.run(['psql', url, '-X', '-q', '-t', '-A', '-c', sql], capture_output=True, text=True, check=True)
    return json.loads(out.stdout.strip() or 'null')


def fetch_centroids(story_ids, cache_name='centroids'):
    """按 story_id 批量取 brief_stories.centroid（e5-small，384 维，未归一化）。结果缓存，重复调用只补缺的。"""
    path = os.path.join(CACHE, f'{cache_name}.json')
    have = json.load(open(path)) if os.path.exists(path) else {}
    need = [int(s) for s in story_ids if str(s) not in have]
    if need:
        ids = ','.join(map(str, need))
        rows = _psql_json(f"select json_object_agg(id, centroid::text) from brief_stories where id in ({ids})") or {}
        for k, v in rows.items():
            have[k] = [float(x) for x in v.strip('[]').split(',')] if v else None
        os.makedirs(CACHE, exist_ok=True)
        json.dump(have, open(path, 'w'))
    return {int(s): have.get(str(s)) for s in story_ids}


def dump_published_stories(out_path, where="r.published_at is not null"):
    """把一批期的入选故事导成原型用的快照（同 thread-worthiness 原型的 all-stories.json 格式）。

    默认 = 全部已发布期。换一批：传 where，例如 "r.published_at > '2026-10-01'"。
    """
    sql = f"""select json_agg(x order by x.published_at, x.story_id) from (
      select bs.id story_id, r.id report_id, coalesce(r.published_at, r.created_at) published_at, bs.title, bs.importance,
             bs.article_count, bs.story_cluster_id, bs.centroid::text centroid, a.id lead_article_id, a.title lead_title,
             a.url lead_url, a.content_file_key lead_content_key, a.primary_location, a.event_summary_points, a.key_entities
      from brief_stories bs join brief_runs br on br.workflow_id = bs.workflow_id join reports r on r.id = br.report_id
      left join articles a on a.id = bs.lead_article_id
      where bs.selected_for_intel and bs.centroid is not null and ({where})) x"""
    stories = _psql_json(sql) or []
    json.dump({'where': where, 'stories': stories}, open(out_path, 'w'), ensure_ascii=False)
    return len(stories)


# ---------- R2 正文 ----------

def fetch_r2_texts(keys, parallel=16):
    """批量取 R2 对象（文章正文等）→ {key: 文本或 None}。缓存到 .cache/r2/，已有的跳过。

    走 `wrangler r2 object get`：每个对象要起一次进程，单个约 10–16 秒，所以一定要并发。
    2026-09 的原型串行拉 812 篇要 40 分钟、另一次卡了 2.5 小时——调用方要给总时长设上限。
    """
    root = os.path.join(CACHE, 'r2')

    def one(key):
        path = os.path.join(root, key)
        if os.path.exists(path) and os.path.getsize(path):
            return key, open(path).read()
        os.makedirs(os.path.dirname(path), exist_ok=True)
        for _ in range(2):
            r = subprocess.run(['pnpm', '-s', 'wrangler', 'r2', 'object', 'get', f'{R2_BUCKET}/{key}', '--remote',
                                '--file', path], cwd=AI_WORKER_DIR, capture_output=True, text=True)
            if r.returncode == 0 and os.path.exists(path) and os.path.getsize(path):
                return key, open(path).read()
        if os.path.exists(path):
            os.remove(path)
        return key, None

    with ThreadPoolExecutor(parallel) as ex:
        return dict(ex.map(one, keys))
