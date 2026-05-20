import { z } from 'zod';

export const articleAnalysisSchema = z.object({
  language: z.string().length(2),
  primary_location: z.string(),
  completeness: z.enum(['COMPLETE', 'PARTIAL_USEFUL', 'PARTIAL_USELESS']),
  content_quality: z.enum(['OK', 'LOW_QUALITY', 'JUNK']),

  event_summary_points: z.array(z.string()),
  thematic_keywords: z.array(z.string()),
  topic_tags: z.array(z.string()),
  key_entities: z.array(z.string()),
  content_focus: z.array(z.string()),
});
