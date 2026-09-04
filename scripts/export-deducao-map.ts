import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { OFFICE_MAP } from '../src/games/deducao/map';

const output = resolve(
  process.cwd(),
  '..',
  'timbas-web',
  'assets',
  'models',
  'deducao',
  'office-map.json',
);

mkdirSync(resolve(output, '..'), { recursive: true });
writeFileSync(output, `${JSON.stringify(OFFICE_MAP, null, 2)}\n`, 'utf8');
console.log(output);
