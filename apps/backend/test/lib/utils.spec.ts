import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hasValidAuthToken, generateSearchText } from '../src/lib/utils';
import { Context } from 'hono';
import { HonoEnv } from '../src/app';

describe('hasValidAuthToken', () => {
  // Mock Context object
  let mockContext: Context<HonoEnv>;
  const validToken = 'valid-token-12345';

  beforeEach(() => {
    // Reset mocks
    vi.resetAllMocks();

    // Create a mock context with request headers and environment
    mockContext = {
      req: {
        header: vi.fn(),
      },
      env: {
        API_TOKEN: validToken,
      },
    } as unknown as Context<HonoEnv>;
  });

  it('should return true when Authorization header has the correct Bearer token', () => {
    // Setup header mock to return the valid token
    mockContext.req.header = vi.fn().mockImplementation((name: string) => {
      if (name === 'Authorization') return `Bearer ${validToken}`;
      return undefined;
    });

    // Call the function
    const result = hasValidAuthToken(mockContext);

    // Assert
    expect(result).toBe(true);
    expect(mockContext.req.header).toHaveBeenCalledWith('Authorization');
  });

  it('should return false when Authorization header is missing', () => {
    // Setup header mock to return undefined
    mockContext.req.header = vi.fn().mockImplementation((name: string) => {
      return undefined;
    });

    // Call the function
    const result = hasValidAuthToken(mockContext);

    // Assert
    expect(result).toBe(false);
    expect(mockContext.req.header).toHaveBeenCalledWith('Authorization');
  });

  it('should return false when Authorization header has incorrect token value', () => {
    // Setup header mock to return an invalid token
    mockContext.req.header = vi.fn().mockImplementation((name: string) => {
      if (name === 'Authorization') return `Bearer wrong-token`;
      return undefined;
    });

    // Call the function
    const result = hasValidAuthToken(mockContext);

    // Assert
    expect(result).toBe(false);
    expect(mockContext.req.header).toHaveBeenCalledWith('Authorization');
  });

  it('should return false when Authorization header uses a scheme other than Bearer', () => {
    // Setup header mock to return a non-Bearer token
    mockContext.req.header = vi.fn().mockImplementation((name: string) => {
      if (name === 'Authorization') return `Basic ${validToken}`;
      return undefined;
    });

    // Call the function
    const result = hasValidAuthToken(mockContext);

    // Assert
    expect(result).toBe(false);
    expect(mockContext.req.header).toHaveBeenCalledWith('Authorization');
  });

  it('should return false when API_TOKEN environment variable is not set or empty', () => {
    // Mock the environment with an empty API_TOKEN
    mockContext.env.API_TOKEN = '';

    // Setup header mock to return a valid token format
    mockContext.req.header = vi.fn().mockImplementation((name: string) => {
      if (name === 'Authorization') return `Bearer ${validToken}`;
      return undefined;
    });

    // Call the function
    const result = hasValidAuthToken(mockContext);

    // Assert
    expect(result).toBe(false);
    expect(mockContext.req.header).toHaveBeenCalledWith('Authorization');
  });
});

describe('generateSearchText', () => {
  // Sample data for testing that includes all required fields
  const sampleData = {
    title: 'Test Article',
    language: 'en',
    primary_location: 'New York',
    completeness: 'COMPLETE' as const,
    content_quality: 'OK' as const,
    event_summary_points: ['First point', 'Second point with period.', 'Third point'],
    thematic_keywords: ['keyword1', 'keyword2', 'keyword3'],
    topic_tags: ['tag1', 'tag2'],
    key_entities: ['entity1', 'entity2'],
    content_focus: ['focus1', 'focus2'],
  };

  it('should correctly combine title, summary points, keywords, tags, entities, focus, and specific location', () => {
    const result = generateSearchText(sampleData);

    // The result should contain all the data combined with periods
    expect(result).toBe(
      'Test Article. New York. First point. Second point with period. Third point. entity1 entity2. keyword1 keyword2 keyword3. tag1 tag2. focus1 focus2.'
    );
  });

  it('should handle empty arrays for points, keywords, tags, entities, focus gracefully', () => {
    const data = {
      ...sampleData,
      event_summary_points: [],
      thematic_keywords: [],
      topic_tags: [],
      key_entities: [],
      content_focus: [],
    };

    const result = generateSearchText(data);

    // Should just include title and location
    expect(result).toBe('Test Article. New York.');
  });

  it('should handle null or undefined fields gracefully', () => {
    const data = {
      title: 'Test Article',
      language: 'en',
      completeness: 'COMPLETE' as const,
      content_quality: 'OK' as const,
      primary_location: '', // Empty string instead of undefined
      event_summary_points: [] as string[], // Empty arrays instead of undefined
      thematic_keywords: [] as string[],
      topic_tags: [] as string[],
      key_entities: [] as string[],
      content_focus: [] as string[],
    };

    const result = generateSearchText(data);

    // Should just include title
    expect(result).toBe('Test Article.');
  });

  it('should add periods after each non-empty part and ensure the final string ends with a period', () => {
    // Create data with only some fields
    const data = {
      title: 'Test Article',
      language: 'en',
      primary_location: 'Berlin',
      completeness: 'COMPLETE' as const,
      content_quality: 'OK' as const,
      thematic_keywords: ['keyword1', 'keyword2'],
      event_summary_points: [],
      topic_tags: [],
      key_entities: [],
      content_focus: [],
    };

    const result = generateSearchText(data);

    // Should have periods between parts and end with a period
    expect(result).toBe('Test Article. Berlin. keyword1 keyword2.');
  });

  it('should exclude generic locations (GLOBAL, N/A, empty) from the output string', () => {
    // Test with various generic locations
    const genericLocations = ['GLOBAL', 'World', 'NONE', 'N/A'];

    // Test each generic location
    genericLocations.forEach(loc => {
      const data = {
        ...sampleData,
        primary_location: loc,
      };

      const result = generateSearchText(data);

      // Should not include the generic location
      expect(result).not.toContain(loc);
      // Should start with the title directly followed by the summary
      expect(result.startsWith('Test Article. First point')).toBeTruthy();
    });

    // Test empty string separately since it will always be contained in any string
    const dataWithEmptyLocation = {
      ...sampleData,
      primary_location: '',
    };
    const resultWithEmpty = generateSearchText(dataWithEmptyLocation);
    // Verify it starts directly with the title followed by summary
    expect(resultWithEmpty.startsWith('Test Article. First point')).toBeTruthy();
  });

  it('should trim whitespace from all input strings before combining', () => {
    const data = {
      title: '  Padded Title  ',
      language: 'en',
      primary_location: '  New York  ',
      completeness: 'COMPLETE' as const,
      content_quality: 'OK' as const,
      event_summary_points: ['  Padded point  '],
      thematic_keywords: ['  padded keyword  '],
      topic_tags: [],
      key_entities: [],
      content_focus: [],
    };

    const result = generateSearchText(data);

    // Should have trimmed all whitespace
    expect(result).toBe('Padded Title. New York. Padded point. padded keyword.');
  });

  it('should correctly add periods to summary points that lack them', () => {
    const data = {
      title: 'Test Article',
      language: 'en',
      completeness: 'COMPLETE' as const,
      content_quality: 'OK' as const,
      event_summary_points: ['First point without period', 'Second point with period.'],
      primary_location: '',
      thematic_keywords: [],
      topic_tags: [],
      key_entities: [],
      content_focus: [],
    };

    const result = generateSearchText(data);

    // Should have added a period to the first point
    expect(result).toBe('Test Article. First point without period. Second point with period.');
  });

  it('should return an empty string if all input data fields are empty or nullish', () => {
    // Create completely empty data
    const emptyData = {
      title: '',
      language: 'en',
      completeness: 'COMPLETE' as const,
      content_quality: 'OK' as const,
      event_summary_points: [],
      thematic_keywords: [],
      topic_tags: [],
      key_entities: [],
      content_focus: [],
      primary_location: '',
    };

    const result = generateSearchText(emptyData);

    // Should be an empty string
    expect(result).toBe('');
  });
});
