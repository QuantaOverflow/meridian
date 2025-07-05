import { describe, it, expect } from 'vitest';
import { ClusteringService, type ArticleDataset } from '../../src/lib/clustering-service';
import type { AIWorkerEnv } from '../../src/lib/ai-services';

// --- Configuration for Live Integration Test ---
const REAL_ML_SERVICE_URL = 'http://107.174.196.203:8080';
const REAL_API_TOKEN = 'f10c0976a3e273a7829666c3c5af658e5d9aee790187617b98e8c6e5d35d6336';
const BAD_API_TOKEN = 'invalid-token-for-testing';

const isServiceReachable = await fetch(`${REAL_ML_SERVICE_URL}/health`, {
    headers: { 'X-API-Token': REAL_API_TOKEN }
}).then(res => res.ok).catch(() => false);

const testEnv: AIWorkerEnv = {
    MERIDIAN_ML_SERVICE_URL: REAL_ML_SERVICE_URL,
    MERIDIAN_ML_SERVICE_API_KEY: REAL_API_TOKEN,
} as any;

// --- Test Data ---

// Dataset designed to produce at least two distinct clusters
const mockArticleRecordsForClustering = [
    // Cluster 1: Technology
    { id: 1, title: 'The Future of AI in Tech', url: 'http://example.com/tech1', publish_date: new Date(), embedding: Array(384).fill(0.1), summary: 'Summary 1' },
    { id: 2, title: 'New Advances in Quantum Computing', url: 'http://example.com/tech2', publish_date: new Date(), embedding: Array(384).fill(0.11), summary: 'Summary 2' },
    { id: 3, title: 'A Review of the Latest Processors', url: 'http://example.com/tech3', publish_date: new Date(), embedding: Array(384).fill(0.12), summary: 'Summary 3' },
    // Cluster 2: Finance
    { id: 4, title: 'Global Market Trends for Q3', url: 'http://example.com/finance1', publish_date: new Date(), embedding: Array(384).fill(0.9), summary: 'Summary 4' },
    { id: 5, title: 'Understanding Inflation in a Digital Age', url: 'http://example.com/finance2', publish_date: new Date(), embedding: Array(384).fill(0.91), summary: 'Summary 5' },
    { id: 6, title: 'Investment Strategies for the Next Decade', url: 'http://example.com/finance3', publish_date: new Date(), embedding: Array(384).fill(0.92), summary: 'Summary 6' },
    // A potential outlier
    { id: 7, title: 'The History of Ancient Art', url: 'http://example.com/art1', publish_date: new Date(), embedding: Array(384).fill(0.5), summary: 'Summary 7' },
];


const prepareDatasetForClustering = (records: typeof mockArticleRecordsForClustering): ArticleDataset => {
    const articles = records.map(article => ({
        id: article.id,
        title: article.title,
        content: article.summary,
        publishDate: article.publish_date.toISOString(),
        url: article.url,
        summary: article.summary,
    }));

    const embeddings = records.map(article => ({
        articleId: article.id,
        embedding: article.embedding as number[],
    }));

    return { articles, embeddings };
};

// --- Test Suite ---
describe.skipIf(!isServiceReachable)('ClusteringService - Integration Test', () => {
    
    const clusteringService = new ClusteringService(testEnv);

    it('should be able to reach the ML service health endpoint', async () => {
        const health = await clusteringService.healthCheck();
        expect(health.success, `Health check failed. Is the service at ${REAL_ML_SERVICE_URL} running and accessible?`).toBe(true);
    });

    it('should form at least two distinct clusters with well-separated data', async () => {
        // Arrange
        const clusteringDataset = prepareDatasetForClustering(mockArticleRecordsForClustering);

        // Act
        const response = await clusteringService.analyzeClusters(clusteringDataset, {
            hdbscanParams: { min_cluster_size: 2, min_samples: 1 }
        });

        // Assert
        expect(response.success, `Clustering analysis failed with error: ${response.error}`).toBe(true);
        const { data } = response;
        expect(data).toBeDefined();
        
        console.log('Distinct Clusters Scenario Result:', JSON.stringify(data, null, 2));
        
        // We expect the service to find the two clear groups we created.
        expect(data!.statistics.totalClusters).toBeGreaterThanOrEqual(2);
        const trueClusters = data!.clusters.filter(c => c.clusterId !== -1);
        expect(trueClusters.length).toBeGreaterThanOrEqual(2);

    }, 30000);

    it('should change clustering results based on hdbscan parameters', async () => {
        // Arrange
        const clusteringDataset = prepareDatasetForClustering(mockArticleRecordsForClustering);

        // Act: Run with a small min_cluster_size, expecting more clusters
        const response1 = await clusteringService.analyzeClusters(clusteringDataset, {
            hdbscanParams: { min_cluster_size: 2 }
        });
        
        // Act: Run with a larger min_cluster_size, expecting fewer clusters
        const response2 = await clusteringService.analyzeClusters(clusteringDataset, {
            hdbscanParams: { min_cluster_size: 4 }
        });

        // Assert
        expect(response1.success).toBe(true);
        expect(response2.success).toBe(true);
        
        console.log('Parameter Test - Small min_cluster_size (2):', JSON.stringify(response1.data!.statistics, null, 2));
        console.log('Parameter Test - Large min_cluster_size (4):', JSON.stringify(response2.data!.statistics, null, 2));

        // The number of clusters found should be different when parameters change.
        expect(response1.data!.statistics.totalClusters).not.toEqual(response2.data!.statistics.totalClusters);

    }, 45000);

    it('should fail with an authentication error for an invalid API token', async () => {
        // Arrange
        const badEnv: AIWorkerEnv = { ...testEnv, MERIDIAN_ML_SERVICE_API_KEY: BAD_API_TOKEN };
        const serviceWithBadToken = new ClusteringService(badEnv);
        const clusteringDataset = prepareDatasetForClustering(mockArticleRecordsForClustering.slice(0, 2));

        // Act
        const response = await serviceWithBadToken.analyzeClusters(clusteringDataset);

        // Assert
        expect(response.success).toBe(false);
        expect(response.error).toBeDefined();
        // A 401 or 403 error is expected for an invalid token
        expect(response.error).toMatch(/ML service failed: 40[13]/);
    }, 30000);
});