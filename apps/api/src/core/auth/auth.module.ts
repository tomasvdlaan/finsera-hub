import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { UserService } from './user.service.js';
import { ZitadelTokens } from './zitadel.tokens.js';

@Module({
  providers: [
    // One key set for the whole process. `AuthGuard` is kept a single instance below for
    // this exact reason; the verifier is where that guarantee now actually lives, and the
    // portal's two token checks share it.
    ZitadelTokens,
    UserService,
    AuthGuard,
    // useExisting, not useClass: the live meeting socket injects AuthGuard directly to
    // verify its token, and both paths must be the same instance — two guards would mean
    // two JWKS caches and, eventually, two subtly different notions of a valid token.
    { provide: APP_GUARD, useExisting: AuthGuard },
  ],
  exports: [UserService, AuthGuard, ZitadelTokens],
})
export class AuthModule {}
