import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { KnowledgeBasePurpose } from '../enums/knowledge-base-purpose.enum';
import { SearchKnowledgeDto } from './search-knowledge.dto';

describe('SearchKnowledgeDto', () => {
  it('rejects an empty query', async () => {
    const dto = plainToInstance(SearchKnowledgeDto, {
      purpose: KnowledgeBasePurpose.QA_CHATBOT,
      query: '',
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'query')).toBe(true);
  });

  it('accepts a valid bounded search request', async () => {
    const dto = plainToInstance(SearchKnowledgeDto, {
      purpose: KnowledgeBasePurpose.RECOMMENDATIONS,
      query: 'pricing terms',
      limit: 5,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });
});
