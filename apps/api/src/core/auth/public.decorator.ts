import { SetMetadata } from '@nestjs/common';

/** Opt a route out of authentication. Use sparingly — health checks and the like. */
export const IS_PUBLIC = 'core:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC, true);
