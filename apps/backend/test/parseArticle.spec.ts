import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseArticle } from '../src/lib/parsers';
import * as linkedom from 'linkedom';
import { Readability } from '@mozilla/readability';

// Mock the Readability and parseHTML dependencies
vi.mock('@mozilla/readability', () => {
  return {
    Readability: vi.fn(),
  };
});

vi.mock('linkedom', () => {
  return {
    parseHTML: vi.fn(),
  };
});

describe('parseArticle', () => {
  // Note: Testing Readability itself is hard. Focus on the wrapper.

  beforeEach(() => {
    vi.resetAllMocks();

    // Default mocks for linkedom
    vi.mocked(linkedom.parseHTML).mockReturnValue({
      document: 'mock-document',
    } as any);
  });

  it('should throw an error if Readability constructor or parse() throws an exception', () => {
    // Setup: Make Readability throw an error
    vi.mocked(Readability).mockImplementation(() => {
      throw new Error('Readability error');
    });

    // Execute & Verify
    expect(() => parseArticle({ html: '<html><body>Test</body></html>' })).toThrow('Article parsing error: Readability error');
  });

  it('should throw an error if Readability returns null', () => {
    // Setup: Make Readability.parse() return null
    vi.mocked(Readability).mockImplementation(() => {
      return {
        parse: () => null,
      } as any;
    });

    // Execute & Verify
    expect(() => parseArticle({ html: '<html><body>Test</body></html>' })).toThrow('No article content found');
  });

  it('should throw an error if Readability result is missing title', () => {
    // Setup: Make Readability.parse() return an object without a title
    vi.mocked(Readability).mockImplementation(() => {
      return {
        parse: () => ({
          title: '', // empty title
          textContent: 'Some content',
        }),
      } as any;
    });

    // Execute & Verify
    expect(() => parseArticle({ html: '<html><body>Test</body></html>' })).toThrow('No article content found');
  });

  it('should throw an error if Readability result is missing textContent', () => {
    // Setup: Make Readability.parse() return an object without textContent
    vi.mocked(Readability).mockImplementation(() => {
      return {
        parse: () => ({
          title: 'Article Title',
          textContent: '', // empty textContent
        }),
      } as any;
    });

    // Execute & Verify
    expect(() => parseArticle({ html: '<html><body>Test</body></html>' })).toThrow('No article content found');
  });

  it('should return the extracted title, cleaned textContent, and publishedTime when successful', () => {
    // Setup: Make Readability.parse() return a valid article
    vi.mocked(Readability).mockImplementation(() => {
      return {
        parse: () => ({
          title: 'Article Title',
          textContent: 'Article content here',
          publishedTime: '2025-03-18T18:04:44-04:00',
        }),
      } as any;
    });

    // Execute
    const result = parseArticle({ html: '<html><body>Test</body></html>' });

    // Verify
    expect(result).toEqual({
      title: 'Article Title',
      text: 'Article content here',
      publishedTime: '2025-03-18T18:04:44-04:00',
    });
  });

  it('should clean and normalize whitespace in the extracted textContent', () => {
    // Setup: Make Readability.parse() return messy text content
    const messyText = '  Multiple    spaces  \n\n\n  and \t\t tabs \n   and extra newlines  ';
    vi.mocked(Readability).mockImplementation(() => {
      return {
        parse: () => ({
          title: 'Article Title',
          textContent: messyText,
        }),
      } as any;
    });

    // Execute
    const result = parseArticle({ html: '<html><body>Test</body></html>' });

    // Verify
    // The text should be cleaned according to the cleanString function logic
    expect(result.text).toBe('Multiple spaces\nand tabs\nand extra newlines');
  });
});
