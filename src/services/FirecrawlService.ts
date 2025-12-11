import axios from 'axios';
import * as cheerio from 'cheerio';

export interface ScrapeOptions {
  maxDepth?: number;
  maxPages?: number;
  includePaths?: string[];
  excludePaths?: string[];
}

export interface ScrapedPage {
  url: string;
  title: string;
  content: string;
  metadata: {
    description?: string;
    keywords?: string[];
    author?: string;
    publishedDate?: string;
  };
  links: string[];
}

export class FirecrawlService {
  private visitedUrls: Set<string> = new Set();
  private userAgent: string = 'RAG-System-Scraper/1.0';

  /**
   * Scrape a single URL
   */
  public async scrapePage(url: string): Promise<ScrapedPage | null> {
    try {
      console.log(`Scraping: ${url}`);
      
      const response = await axios.get(url, {
        headers: {
          'User-Agent': this.userAgent,
        },
        timeout: 10000,
      });

      const $ = cheerio.load(response.data);

      // Remove script and style elements
      $('script, style, nav, footer, aside').remove();

      // Extract content
      const title = $('title').text().trim() || $('h1').first().text().trim();
      const description = $('meta[name="description"]').attr('content');
      const keywords = $('meta[name="keywords"]').attr('content')?.split(',').map(k => k.trim());
      const author = $('meta[name="author"]').attr('content');
      const publishedDate = $('meta[property="article:published_time"]').attr('content');

      // Extract main content
      const contentSelectors = [
        'article',
        'main',
        '.content',
        '.post-content',
        '#content',
        'body',
      ];

      let content = '';
      for (const selector of contentSelectors) {
        const element = $(selector);
        if (element.length > 0) {
          content = element.text().trim();
          if (content.length > 100) {
            break;
          }
        }
      }

      // Clean up whitespace
      content = content.replace(/\s+/g, ' ').trim();

      // Extract links
      const links: string[] = [];
      $('a[href]').each((_, element) => {
        const href = $(element).attr('href');
        if (href) {
          try {
            const absoluteUrl = new URL(href, url).href;
            links.push(absoluteUrl);
          } catch {
            // Invalid URL, skip
          }
        }
      });

      return {
        url,
        title,
        content,
        metadata: {
          description,
          keywords,
          author,
          publishedDate,
        },
        links: [...new Set(links)], // Unique links only
      };
    } catch (error) {
      console.error(`Failed to scrape ${url}:`, error);
      return null;
    }
  }

  /**
   * Crawl a website recursively
   */
  public async crawlWebsite(
    startUrl: string,
    options: ScrapeOptions = {}
  ): Promise<ScrapedPage[]> {
    const {
      maxDepth = 2,
      maxPages = 50,
      includePaths = [],
      excludePaths = [],
    } = options;

    this.visitedUrls.clear();
    const results: ScrapedPage[] = [];
    const queue: Array<{ url: string; depth: number }> = [{ url: startUrl, depth: 0 }];

    while (queue.length > 0 && results.length < maxPages) {
      const { url, depth } = queue.shift()!;

      // Skip if already visited
      if (this.visitedUrls.has(url)) {
        continue;
      }

      // Skip if depth exceeded
      if (depth > maxDepth) {
        continue;
      }

      // Check path filters
      if (excludePaths.some(path => url.includes(path))) {
        continue;
      }

      if (includePaths.length > 0 && !includePaths.some(path => url.includes(path))) {
        continue;
      }

      // Mark as visited
      this.visitedUrls.add(url);

      // Scrape the page
      const page = await this.scrapePage(url);
      if (page) {
        results.push(page);

        // Add child links to queue
        if (depth < maxDepth) {
          const baseUrl = new URL(url);
          for (const link of page.links) {
            try {
              const linkUrl = new URL(link);
              // Only crawl same domain
              if (linkUrl.hostname === baseUrl.hostname) {
                queue.push({ url: link, depth: depth + 1 });
              }
            } catch {
              // Invalid URL, skip
            }
          }
        }
      }

      // Rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    console.log(`✓ Crawled ${results.length} pages from ${startUrl}`);
    return results;
  }

  /**
   * Convert scraped pages to RAG documents
   */
  public pagesToDocuments(pages: ScrapedPage[]): Array<{
    content: string;
    metadata: Record<string, any>;
    source: string;
  }> {
    return pages.map(page => ({
      content: `${page.title}\n\n${page.content}`,
      metadata: {
        title: page.title,
        url: page.url,
        ...page.metadata,
      },
      source: page.url,
    }));
  }
}

export const firecrawlService = new FirecrawlService();
