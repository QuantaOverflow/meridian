import { getDb as getDbFromDatabase } from '@meridian/database';
import { Context } from 'hono';
import { HonoEnv } from '../app';
import { articleAnalysisSchema } from '../prompts/articleAnalysis.prompt';
import { z } from 'zod';

export function getDb(hyperdrive: Hyperdrive) {
  return getDbFromDatabase(hyperdrive.connectionString, {
    // Workers limit the number of concurrent external connections, so be sure to limit
    // the size of the local connection pool that postgres.js may establish.
    max: 5,

    // If you are not using array types in your Postgres schema,
    // disabling this will save you an extra round-trip every time you connect.
    fetch_types: false,
  });
}

export function hasValidAuthToken(c: Context<HonoEnv>) {
  const auth = c.req.header('Authorization');
  if (auth === undefined || auth !== `Bearer ${c.env.API_TOKEN}`) {
    return false;
  }
  return true;
}

export const userAgents = [
  // ios (golden standard for publishers)
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1', // iphone safari (best overall)
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0.6312.87 Mobile/15E148 Safari/604.1', // iphone chrome

  // android (good alternatives)
  'Mozilla/5.0 (Linux; Android 14; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36', // samsung flagship
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36', // pixel
];

export function generateSearchText(data: z.infer<typeof articleAnalysisSchema> & { title: string }): string {
  // helper to safely join string arrays, filtering out empty/nullish items
  const joinSafely = (arr: string[] | null | undefined): string =>
    (arr ?? [])
      .map(s => s?.trim())
      .filter(Boolean)
      .join(' ');

  // process summary points: trim, filter empty, ensure period, join
  const summary = (data.event_summary_points ?? [])
    .map(p => p?.trim() ?? '') // trim first
    .filter(p => p !== '') // remove empties *after* trimming
    .map(p => (p.endsWith('.') ? p : `${p}.`)) // add period if needed
    .join(' '); // join with space

  // process other text arrays simply
  const keywords = joinSafely(data.thematic_keywords);
  const tags = joinSafely(data.topic_tags);
  const entities = joinSafely(data.key_entities);
  const focus = joinSafely(data.content_focus);

  // process location: clean up, remove generic placeholders
  let location = data.primary_location?.trim() ?? '';
  const nonSpecificLocations = ['GLOBAL', 'WORLD', '', 'NONE', 'N/A'];
  if (nonSpecificLocations.includes(location.toUpperCase())) {
    location = ''; // discard if generic
  }

  // get the title safely
  const title = data.title?.trim() ?? '';

  // --- build the final string ---

  // Create an array of parts that need to be joined
  const parts = [
    title,
    location, // only included if specific and non-empty
    summary,
    entities,
    keywords,
    tags,
    focus,
  ]
    .filter(Boolean) // filter(Boolean) removes empty strings, null, undefined
    .map(part => part.trim())
    .filter(part => part !== '');

  // Join parts with a period and space, but only if the part doesn't already end with a period
  let combined = '';
  parts.forEach((part, index) => {
    // First part has no leading separator
    if (index === 0) {
      combined = part;
    } else {
      // Only add a period before the next part if the previous part doesn't end with one
      if (combined.endsWith('.')) {
        combined += ' ' + part;
      } else {
        combined += '. ' + part;
      }
    }
  });

  // ensure the final string ends with a period if it contains text
  if (combined && !combined.endsWith('.')) {
    combined += '.';
  }

  return combined;
}

/**
 * Simple async error wrapper that returns null on error instead of throwing
 * @param asyncFn Promise to execute
 * @returns The result or null if error occurred
 */
export async function safeAsync<T>(asyncFn: Promise<T>): Promise<T | null> {
  try {
    return await asyncFn;
  } catch (error) {
    return null;
  }
}
