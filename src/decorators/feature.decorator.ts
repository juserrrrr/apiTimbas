import { SetMetadata } from '@nestjs/common';

export const FEATURE_KEY = 'feature';
export const RequireFeature = (key: string) => SetMetadata(FEATURE_KEY, key);
