import { isSupportedKnowledgeUploadFile } from './knowledge.controller';

describe('Knowledge upload validation', () => {
  it('rejects PPTX before indexing starts', () => {
    expect(
      isSupportedKnowledgeUploadFile({
        originalname: 'deck.pptx',
        mimetype: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }),
    ).toBe(false);
  });

  it.each([
    ['guide.pdf', 'application/pdf'],
    [
      'guide.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    [
      'table.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    ['guide.txt', 'text/plain'],
    ['table.csv', 'text/csv'],
    ['payload.json', 'application/json'],
    ['guide.md', 'text/markdown'],
    ['guide.markdown', 'text/markdown'],
    ['guide.md', 'text/plain'],
    ['guide.markdown', 'text/plain'],
  ])('allows supported document format %s with %s', (originalname, mimetype) => {
    expect(isSupportedKnowledgeUploadFile({ originalname, mimetype })).toBe(true);
  });

  it('allows supported OCR image formats', () => {
    expect(
      isSupportedKnowledgeUploadFile({
        originalname: 'scan.png',
        mimetype: 'image/png',
      }),
    ).toBe(true);
    expect(
      isSupportedKnowledgeUploadFile({
        originalname: 'scan.jpg',
        mimetype: 'image/jpeg',
      }),
    ).toBe(true);
    expect(
      isSupportedKnowledgeUploadFile({
        originalname: 'scan.jpeg',
        mimetype: 'image/jpeg',
      }),
    ).toBe(true);
  });

  it('rejects unsupported image formats', () => {
    expect(
      isSupportedKnowledgeUploadFile({
        originalname: 'scan.webp',
        mimetype: 'image/webp',
      }),
    ).toBe(false);
  });

  it.each([
    ['scan.txt', 'image/jpeg'],
    ['scan.png', 'text/plain'],
    ['scan.jpg', 'image/png'],
    ['scan.pdf', 'image/jpeg'],
    ['scan.csv', 'application/json'],
  ])('rejects mismatched upload pair %s with %s', (originalname, mimetype) => {
    expect(isSupportedKnowledgeUploadFile({ originalname, mimetype })).toBe(false);
  });

  it('rejects generic octet-stream uploads', () => {
    expect(
      isSupportedKnowledgeUploadFile({
        originalname: 'guide.md',
        mimetype: 'application/octet-stream',
      }),
    ).toBe(false);
  });
});
