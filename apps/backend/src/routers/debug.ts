import { Hono } from 'hono';
import type { Env as BaseEnv } from '../index';
import type { BriefGenerationParams } from '../workflows/auto-brief-generation';

// By extending the base Env, we can provide a more accurate type for the
// specific bindings used in this testing router.
type TestEnv = BaseEnv & {
    MY_WORKFLOW: any; // Use any to bypass complex workflow typing issues
};

const debugRouter = new Hono<{ Bindings: TestEnv }>();

/**
 * A debug endpoint to facilitate end-to-end testing of the brief generation workflow.
 * This endpoint will trigger the AutoBriefGenerationWorkflow, which will then operate
 * on the articles currently available in the database connected via Hyperdrive.
 */
debugRouter.post('/trigger-brief-workflow', async (c) => {
    try {
        const workflowId = `e2e-manual-trigger-${Date.now()}`;
        console.log(`Creating new workflow instance with ID: ${workflowId}`);

        const payload: BriefGenerationParams = {
            triggeredBy: 'debug-endpoint',
            timeRangeDays: 7, // The workflow will query articles from the last 7 days (adjusted for testing)
            articleLimit: 50, // Limit to 50 articles for testing
            minImportance: 3,
            maxStoriesToGenerate: 10,
            storyMinImportance: 0.1,
            clusteringOptions: {
                strategy: 'simple_cosine',
                preprocessing: 'normalize',
                min_quality_score: 0.5
            }
        };

        // Use the correct Cloudflare Workflows API to create a new workflow instance
        // The binding name 'MY_WORKFLOW' matches the configuration in wrangler.jsonc
        const workflowInstance = await c.env.MY_WORKFLOW.create({
            id: workflowId,
            params: payload
        });

        console.log('Workflow instance created successfully:', workflowInstance.id);

        return c.json({
            success: true,
            message: 'Auto brief generation workflow created and started successfully.',
            workflowId: workflowInstance.id,
            payload: payload,
            note: "The workflow is now running. Check wrangler dev logs for progress and the database for the generated report.",
        });

    } catch (error) {
        console.error('Failed to create workflow instance:', error);
        return c.json({
            success: false,
            message: 'Failed to create workflow instance.',
            error: error instanceof Error ? error.message : String(error),
        }, 500);
    }
});

/**
 * A debug endpoint to check the status of a workflow instance
 */
debugRouter.get('/workflow-status/:workflowId', async (c) => {
    try {
        const workflowId = c.req.param('workflowId');
        
        // Note: Workflow status checking might not be directly available
        // This is a placeholder for potential future functionality
        return c.json({
            success: true,
            workflowId: workflowId,
            status: 'Status checking not implemented yet',
            note: 'Check wrangler dev logs for workflow progress'
        });
    } catch (error) {
        console.error('Failed to get workflow status:', error);
        return c.json({
            success: false,
            message: 'Failed to get workflow status.',
            error: error instanceof Error ? error.message : String(error),
        }, 500);
    }
});

export default debugRouter; 