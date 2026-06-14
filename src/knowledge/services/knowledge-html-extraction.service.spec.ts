import { BadRequestException } from '@nestjs/common';
import { KnowledgeHtmlExtractionService } from './knowledge-html-extraction.service';

describe('KnowledgeHtmlExtractionService', () => {
  let service: KnowledgeHtmlExtractionService;

  beforeEach(() => {
    service = new KnowledgeHtmlExtractionService();
  });

  it('extracts title and readable body text from HTML', () => {
    const result = service.extract(`
      <html>
        <head><title>Example page</title></head>
        <body>
          <main>
            <h1>Sales guide</h1>
            <p>Useful recommendations for customers.</p>
          </main>
        </body>
      </html>
    `);

    expect(result.title).toBe('Example page');
    expect(result.blocks[0].text).toContain('Sales guide');
    expect(result.blocks[0].text).toContain('Useful recommendations');
  });

  it('strips scripts, styles, and navigation-like markup', () => {
    const result = service.extract(`
      <html>
        <head>
          <style>.secret { display: none; }</style>
          <script>window.secret = "token";</script>
        </head>
        <body>
          <nav>Menu item</nav>
          <main><p>Actual useful page content for indexing.</p></main>
          <footer>Footer links</footer>
        </body>
      </html>
    `);

    expect(result.blocks[0].text).toContain('Actual useful page content');
    expect(result.blocks[0].text).not.toContain('window.secret');
    expect(result.blocks[0].text).not.toContain('Menu item');
    expect(result.blocks[0].text).not.toContain('Footer links');
  });

  it('fails safely when extracted text is too short', () => {
    expect(() => service.extract('<html><body>short</body></html>')).toThrow(
      BadRequestException,
    );
  });
});
