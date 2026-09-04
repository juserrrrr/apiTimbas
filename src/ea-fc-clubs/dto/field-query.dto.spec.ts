import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { EaFieldQueryDto } from './field-query.dto';

describe('EaFieldQueryDto', () => {
  it('uses 25 matches by default', async () => {
    const query = plainToInstance(EaFieldQueryDto, {});

    expect(await validate(query)).toHaveLength(0);
    expect(query.matches).toBe(25);
  });

  it('accepts and transforms a supported match window', async () => {
    const query = plainToInstance(EaFieldQueryDto, { matches: '5' });

    expect(await validate(query)).toHaveLength(0);
    expect(query.matches).toBe(5);
  });

  it('rejects an unsupported match window', async () => {
    const query = plainToInstance(EaFieldQueryDto, { matches: '7' });

    expect(await validate(query)).not.toHaveLength(0);
  });
});
