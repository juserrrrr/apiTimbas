import { SetMetadata } from '@nestjs/common';

export const FEATURE_KEY = 'feature';
export const RequireFeature = (...keys: string[]) => SetMetadata(FEATURE_KEY, keys);
