# Meridian ML Service

一个高性能的机器学习服务，为Meridian项目提供**嵌入生成**和**智能文本聚类**功能。

## 🚀 功能特性

### ✅ 已实现功能
- **🧮 嵌入生成**: 使用 `multilingual-e5-small` 模型生成384维文本嵌入
- **🔗 智能文本聚类**: UMAP降维 + HDBSCAN聚类算法
- **🎯 参数自动优化**: 基于DBCV的网格搜索最佳参数（新功能）
- **📊 聚类质量评估**: DBCV (Density-Based Cluster Validation) 分数
- **🔒 API认证**: Bearer Token身份验证
- **🐳 容器化**: Docker + Docker Compose支持
- **☁️ 云部署**: Fly.io生产就绪配置
- **📊 健康监控**: 详细的健康检查端点

### 🎯 核心算法
- **嵌入模型**: `intfloat/multilingual-e5-small` (384维)
- **降维算法**: UMAP (Uniform Manifold Approximation and Projection)
- **聚类算法**: HDBSCAN (Hierarchical Density-Based Spatial Clustering)
- **参数优化**: 网格搜索 + DBCV质量评估

### 🆕 参数优化功能
基于 `reportV5.md` 的实现，提供智能参数调优：
- **自动网格搜索**: 自动测试多种参数组合
- **DBCV评估**: 使用Density-Based Cluster Validation评估聚类质量
- **最佳参数选择**: 自动选择DBCV分数最高的参数组合
- **性能对比**: 提供优化前后的性能对比

## 📦 快速开始

### 本地开发

#### 1. 安装依赖
```bash
cd services/meridian-ml-service

# 使用uv (推荐)
pip install uv
uv pip install -e .

# 或使用pip
pip install -e .
```

#### 2. 环境配置
```bash
# 创建.env文件
echo "API_TOKEN=dev-token-123" > .env
echo "EMBEDDING_MODEL_NAME=intfloat/multilingual-e5-small" >> .env
```

#### 3. 启动服务
```bash
# 使用启动脚本（推荐）
chmod +x start_local.sh
./start_local.sh

# 或直接启动
uvicorn src.meridian_ml_service.main:app --reload --host 0.0.0.0 --port 8080
```

#### 4. 运行测试
```bash
# 运行完整测试套件
python test_local.py
```

## 🔌 API文档

### 基础端点

#### `GET /` - 服务信息
```json
{
  "status": "ok",
  "service": "Meridian ML Service", 
  "features": ["embeddings", "clustering", "parameter_optimization"],
  "models": {
    "embedding": "intfloat/multilingual-e5-small",
    "clustering": "UMAP + HDBSCAN with Grid Search Optimization"
  }
}
```

#### `GET /health` - 健康检查
```json
{
  "status": "healthy",
  "embedding_model": "intfloat/multilingual-e5-small",
  "clustering_available": true,
  "optimization_available": true,
  "timestamp": 1703097600.0
}
```

### 嵌入生成

#### `POST /embeddings`
生成文本嵌入向量

**请求体**:
```json
{
  "texts": ["文本1", "文本2", "..."]
}
```

**响应**:
```json
{
  "embeddings": [[0.1, 0.2, ...], [0.3, 0.4, ...]],
  "model_name": "intfloat/multilingual-e5-small"
}
```

### 标准聚类分析

#### `POST /clustering`
使用固定参数进行聚类分析

**请求体**:
```json
{
  "texts": ["文本1", "文本2", "..."],
  "config": {
    "umap_n_components": 10,
    "umap_n_neighbors": 15,
    "umap_min_dist": 0.0,
    "hdbscan_min_cluster_size": 5,
    "hdbscan_min_samples": 3,
    "hdbscan_cluster_selection_epsilon": 0.0
  },
  "return_embeddings": false,
  "return_reduced_embeddings": true
}
```

### 🎯 智能参数优化聚类

#### `POST /clustering/optimized` （新功能）
使用网格搜索自动优化参数

**请求体**:
```json
{
  "texts": ["文本1", "文本2", "..."],
  "grid_config": {
    "umap_n_neighbors": [10, 15, 20, 30],
    "umap_n_components": 10,
    "umap_min_dist": 0.0,
    "hdbscan_min_cluster_size": [5, 8, 10, 15],
    "hdbscan_min_samples": [2, 3, 5],
    "hdbscan_epsilon": [0.1, 0.2, 0.3]
  },
  "return_embeddings": false,
  "return_reduced_embeddings": true
}
```

**响应**:
```json
{
  "cluster_labels": [0, 1, 0, -1, ...],
  "clustering_stats": {
    "n_samples": 100,
    "n_clusters": 5, 
    "n_outliers": 3,
    "outlier_ratio": 0.03,
    "cluster_sizes": {"0": 20, "1": 15, ...},
    "dbcv_score": 0.452
  },
  "optimization": {
    "used": true,
    "best_params": {
      "umap": {"n_neighbors": 15, "n_components": 10, ...},
      "hdbscan": {"min_cluster_size": 8, "min_samples": 3, "epsilon": 0.2}
    },
    "best_dbcv_score": 0.452
  },
  "config_used": {...},
  "reduced_embeddings": [[...], [...], ...],
  "cluster_content": {
    "0": ["text1", "text2", ...],
    "1": ["text3", "text4", ...]
  }
}
```

### 完整流水线

#### `POST /embeddings-and-clustering`
一站式服务：嵌入生成 + 聚类分析（支持参数优化）

**请求体**:
```json
{
  "texts": ["文本1", "文本2", "..."],
  "use_optimization": true,
  "grid_config": {
    "umap_n_neighbors": [10, 15, 20],
    "hdbscan_min_cluster_size": [5, 8, 10],
    "hdbscan_min_samples": [2, 3],
    "hdbscan_epsilon": [0.1, 0.2, 0.3]
  },
  "include_cluster_content": true,
  "content_top_n": 5
}
```

## 🛠️ 配置说明

### 环境变量
- `EMBEDDING_MODEL_NAME`: 嵌入模型名称 (默认: `intfloat/multilingual-e5-small`)
- `API_TOKEN`: API认证令牌
- `PYTHONUNBUFFERED`: 设为1以禁用Python输出缓冲

### 聚类参数

#### UMAP参数（基于reportV5.md优化）
- `umap_n_components`: 降维目标维度 (默认: 10)
- `umap_n_neighbors`: 邻居数量 (默认: 15, 网格搜索: [10, 15, 20, 30])  
- `umap_min_dist`: 最小距离 (默认: 0.0)
- `umap_metric`: 距离度量 (默认: 'cosine')

#### HDBSCAN参数（基于reportV5.md优化）
- `hdbscan_min_cluster_size`: 最小簇大小 (默认: 5, 网格搜索: [5, 8, 10, 15])
- `hdbscan_min_samples`: 最小样本数 (默认: 3, 网格搜索: [2, 3, 5])
- `hdbscan_cluster_selection_epsilon`: epsilon参数 (默认: 0.0, 网格搜索: [0.1, 0.2, 0.3])
- `hdbscan_metric`: 距离度量 (默认: 'euclidean')

#### 网格搜索配置
```python
# 默认搜索空间（基于reportV5.md）
grid_config = {
    "umap_n_neighbors": [10, 15, 20, 30],        # 4个候选值
    "hdbscan_min_cluster_size": [5, 8, 10, 15],  # 4个候选值
    "hdbscan_min_samples": [2, 3, 5],            # 3个候选值
    "hdbscan_epsilon": [0.1, 0.2, 0.3]           # 3个候选值
}
# 总组合数: 4 × 4 × 3 × 3 = 144种组合
```

## 📊 性能考虑

### 参数优化时间复杂度
- **标准聚类**: O(嵌入生成 + UMAP + HDBSCAN)
- **优化聚类**: O(嵌入生成 + 网格搜索 × (UMAP + HDBSCAN + DBCV))
- **网格搜索**: 默认测试144种参数组合

### 推荐配置

#### 小规模测试 (< 100文本)
- **参数组合**: 减少网格搜索空间
- **推荐**: `umap_n_neighbors: [10, 15]`, `hdbscan_min_cluster_size: [3, 5]`

#### 中等规模 (100-1000文本)  
- **CPU**: 4核心
- **内存**: 4-8GB
- **网格搜索**: 使用默认配置

#### 大规模 (> 1000文本)
- **CPU**: 8+核心  
- **内存**: 16+GB
- **优化策略**: 首次优化后保存最佳参数，后续使用固定参数

## 🔧 开发

### 测试套件
```bash
# 运行完整测试（包含参数优化）
python test_local.py

# 测试覆盖：
# ✅ 健康检查
# ✅ 嵌入生成
# ✅ 标准聚类
# ✅ 参数优化聚类  
# ✅ 完整流水线（标准）
# ✅ 完整流水线（优化）
```

### 代码质量
```bash
# 格式化代码
ruff format .

# 代码检查
ruff check .

# 类型检查
mypy src/
```

## 🤝 集成示例

### 与Meridian Backend集成
```typescript
// 使用参数优化聚类
const response = await fetch('http://ml-service:8080/clustering/optimized', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${ML_API_TOKEN}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    texts: articles.map(a => a.content),
    grid_config: {
      umap_n_neighbors: [10, 15, 20],
      hdbscan_min_cluster_size: [Math.max(3, articles.length / 20), 
                                Math.max(5, articles.length / 15)],
      hdbscan_min_samples: [2, 3],
      hdbscan_epsilon: [0.1, 0.2, 0.3]
    }
  })
});

const result = await response.json();
console.log(`聚类优化结果: DBCV分数=${result.optimization.best_dbcv_score}`);
```

## 📝 更新日志

### v0.3.0 (当前版本) - 参数优化版
- ✅ **新增**: 网格搜索参数优化功能
- ✅ **新增**: DBCV聚类质量评估
- ✅ **新增**: `/clustering/optimized` API端点
- ✅ **优化**: 基于reportV5.md的算法实现
- ✅ **改进**: 完整的参数优化测试套件
- ✅ **更新**: 默认参数调整为最佳实践值

### v0.2.0 
- ✅ 添加UMAP+HDBSCAN聚类功能
- ✅ 完整的API文档和类型定义  
- ✅ Docker Compose开发环境
- ✅ 本地测试脚本
- ✅ 健康检查端点

### v0.1.0 
- ✅ 基础嵌入生成功能
- ✅ FastAPI框架
- ✅ Docker容器化
- ✅ Fly.io部署配置

## 🐛 故障排查

### 常见问题

#### 1. 聚类依赖未安装
```
错误: ImportError: 聚类功能需要安装: pip install umap-learn hdbscan scikit-learn
解决: pip install umap-learn hdbscan scikit-learn
```

#### 2. 参数优化耗时过长
```
问题: 网格搜索需要很长时间
解决:
- 减少参数候选值数量
- 使用较小的测试数据集
- 首次优化后保存最佳参数
```

#### 3. DBCV计算失败
```
问题: DBCV分数计算错误
原因: 数据维度不匹配或簇结构问题
解决:
- 检查降维后的数据质量
- 调整UMAP参数
- 确保有足够的有效数据点
```

#### 4. 聚类结果全是异常点
```
问题: 所有数据点被标记为-1（异常点）
解决:
- 减少hdbscan_min_cluster_size
- 增加样本数量
- 调整umap_n_neighbors参数
- 使用参数优化功能自动寻找最佳参数
```

## 🎯 最佳实践

### 1. 参数选择策略
```python
# 根据数据规模选择网格搜索范围
def get_grid_config(text_count):
    if text_count < 50:
        return {
            "umap_n_neighbors": [5, 10],
            "hdbscan_min_cluster_size": [3, 5],
            "hdbscan_min_samples": [2],
            "hdbscan_epsilon": [0.1, 0.2]
        }
    elif text_count < 200:
        return {
            "umap_n_neighbors": [10, 15, 20],
            "hdbscan_min_cluster_size": [5, 8],
            "hdbscan_min_samples": [2, 3],
            "hdbscan_epsilon": [0.1, 0.2, 0.3]
        }
    else:
        # 使用完整网格搜索
        return None  # 使用默认配置
```

### 2. 生产环境优化
```python
# 两阶段策略：优化 + 固定参数
# 第一次：使用参数优化
optimization_result = await ml_service.optimized_clustering(texts)
best_params = optimization_result['optimization']['best_params']

# 后续：使用固定的最佳参数
fixed_result = await ml_service.clustering(texts, config=best_params)
```

## 📞 支持

- **项目仓库**: [Meridian](https://github.com/your-org/meridian)
- **问题反馈**: GitHub Issues
- **技术文档**: `docs/` 目录
- **参数优化**: 基于reportV5.md的最佳实践 