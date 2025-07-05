import { describe, it, expect, vi, beforeEach,type Mock } from 'vitest';
import { ClusteringService, type ArticleDataset, type ClusteringResult } from '../../src/lib/clustering-service';
import type { AIWorkerEnv } from '../../src/lib/ai-services';

// Mock the global fetch
global.fetch = vi.fn();

const mockEnv: AIWorkerEnv = {
    MERIDIAN_ML_SERVICE_URL: 'https://ml.meridian.dev',
    MERIDIAN_ML_SERVICE_API_KEY: 'test-api-key',
    // Other env properties are not needed for this test
} as any;

// Realistic mock data mimicking database records from the workflow
const mockArticleRecords = [
    // Valid article that should pass quality control
    { id: 1, title: 'Valid Article 1', url: 'http://example.com/1', contentFileKey: 'key1', publish_date: new Date(), embedding: Array(384).fill(0.1), content_quality: 'OK', completeness: 'COMPLETE', summary: 'Summary for article 1.' },
    // Valid article 2
    { id: 2, title: 'Valid Article 2', url: 'http://example.com/2', contentFileKey: 'key2', publish_date: new Date(), embedding: Array(384).fill(0.2), content_quality: 'OK', completeness: 'COMPLETE', summary: 'Summary for article 2.' },
    // Valid article 3
    { id: 3, title: 'Valid Article 3', url: 'http://example.com/3', contentFileKey: 'key3', publish_date: new Date(), embedding: Array(384).fill(0.3), content_quality: 'OK', completeness: 'COMPLETE', summary: 'Summary for article 3.' },
    // Article with low quality, should be filtered out
    { id: 4, title: 'Low Quality Article', url: 'http://example.com/4', contentFileKey: 'key4', publish_date: new Date(), embedding: Array(384).fill(0.4), content_quality: 'LOW_QUALITY', completeness: 'COMPLETE', summary: 'Summary for article 4.' },
    // Article with no embedding, should be filtered out
    { id: 5, title: 'No Embedding Article', url: 'http://example.com/5', contentFileKey: 'key5', publish_date: new Date(), embedding: null, content_quality: 'OK', completeness: 'COMPLETE', summary: 'Summary for article 5.' },
    // Article with no content file key, should be filtered out
    { id: 6, title: 'No Content Key Article', url: 'http://example.com/6', contentFileKey: null, publish_date: new Date(), embedding: Array(384).fill(0.6), content_quality: 'OK', completeness: 'COMPLETE', summary: 'Summary for article 6.' },
];


/**
 * Simulates the data preparation logic from the `auto-brief-generation.ts` workflow.
 * It takes raw article records, applies quality control, and prepares the dataset
 * exactly as the ClusteringService would receive it in that production scenario.
 */
const prepareDatasetForClustering = (records: typeof mockArticleRecords): ArticleDataset => {
    const validArticles = records.filter(r =>
        r.contentFileKey &&
        Array.isArray(r.embedding) &&
        r.embedding.length === 384 &&
        r.content_quality === 'OK'
    );

    // In the workflow, the `content` passed to the service is actually the article's summary.
    // The service itself is responsible for not sending this field to the ML endpoint.
    const articles = validArticles.map(article => ({
        id: article.id,
        title: article.title,
        content: article.summary, // This mimics the workflow behavior.
        publishDate: article.publish_date.toISOString(),
        url: article.url,
        summary: article.summary,
    }));

    const embeddings = validArticles.map(article => ({
        articleId: article.id,
        embedding: article.embedding as number[],
    }));

    return { articles, embeddings };
};


describe('ClusteringService - Production Scenario', () => {
    let clusteringService: ClusteringService;

    beforeEach(() => {
        vi.resetAllMocks();
        clusteringService = new ClusteringService(mockEnv);
    });

    it('should successfully perform clustering with data prepared like in auto-brief-generation workflow', async () => {
        // Arrange
        const clusteringDataset = prepareDatasetForClustering(mockArticleRecords);
        expect(clusteringDataset.articles.length).toBe(3); // Verify filtering logic

        const mockMlResult: Partial<ClusteringResult> = {
            clusters: [{ clusterId: 0, articleIds: [1, 2, 3], size: 3 }],
            statistics: { totalClusters: 1, noisePoints: 0, totalArticles: 3 },
        };

        (fetch as Mock).mockResolvedValue(new Response(JSON.stringify({
            clusters: [{
                cluster_id: 0,
                size: 3,
                items: [{ id: 1 }, { id: 2 }, { id: 3 }]
            }],
            clustering_stats: {
                n_clusters: 1,
                n_outliers: 0,
                n_samples: 3
            },
            config_used: {}
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));

        // Act
        const response = await clusteringService.analyzeClusters(clusteringDataset);

        // Assert
        expect(response.success).toBe(true);
        expect(response.data?.clusters).toEqual(mockMlResult.clusters);
        expect(response.data?.statistics).toEqual(mockMlResult.statistics);

        // Verify fetch was called correctly
        expect(fetch).toHaveBeenCalledTimes(1);
        const fetchCall = (fetch as Mock).mock.calls[0];
        const request: Request = fetchCall[0];

        expect(request.url).toBe(`${mockEnv.MERIDIAN_ML_SERVICE_URL}/ai-worker/clustering?return_embeddings=false&return_reduced_embeddings=false`);
        expect(request.method).toBe('POST');
        expect(request.headers.get('X-API-Token')).toBe(mockEnv.MERIDIAN_ML_SERVICE_API_KEY);
        expect(request.headers.get('Content-Type')).toBe('application/json');

        const body = await request.json() as {items: any[]};
        expect(body.items.length).toBe(3);

        // CRITICAL: Verify that the 'content' field was NOT sent to the ML service, as per the optimization.
        body.items.forEach((item: any) => {
            expect(item.content).toBeUndefined();
            expect(item).toHaveProperty('id');
            expect(item).toHaveProperty('title');
            expect(item).toHaveProperty('url');
            expect(item).toHaveProperty('embedding');
            expect(item).toHaveProperty('summary');
        });
    });

    it('should return an error if the ML service fetch fails', async () => {
        // Arrange
        const clusteringDataset = prepareDatasetForClustering(mockArticleRecords);
        (fetch as Mock).mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

        // Act
        const response = await clusteringService.analyzeClusters(clusteringDataset);

        // Assert
        expect(response.success).toBe(false);
        expect(response.error).toContain('ML service failed: 500');
    });

    it('should return an error for empty dataset', async () => {
        // Arrange
        const emptyDataset: ArticleDataset = { articles: [], embeddings: [] };

        // Act
        const response = await clusteringService.analyzeClusters(emptyDataset);

        // Assert
        expect(response.success).toBe(false);
        expect(response.error).toBe('Dataset is empty');
        expect(fetch).not.toHaveBeenCalled();
    });

    it('should return an error for mismatched articles and embeddings', async () => {
        // Arrange
        const mismatchedDataset = prepareDatasetForClustering(mockArticleRecords);
        mismatchedDataset.embeddings.pop(); // Remove one embedding to create a mismatch

        // Act
        const response = await clusteringService.analyzeClusters(mismatchedDataset);

        // Assert
        expect(response.success).toBe(false);
        expect(response.error).toBe('Mismatch between articles and embeddings count');
        expect(fetch).not.toHaveBeenCalled();
    });
});
