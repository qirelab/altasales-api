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

  it('allows supported document formats', () => {
    expect(
      isSupportedKnowledgeUploadFile({
        originalname: 'guide.docx',
        mimetype: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    ).toBe(true);
  });
});
