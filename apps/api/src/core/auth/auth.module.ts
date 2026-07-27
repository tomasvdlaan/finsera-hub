import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard.js';
import { UserService } from './user.service.js';

@Module({
  providers: [UserService, { provide: APP_GUARD, useClass: AuthGuard }],
  exports: [UserService],
})
export class AuthModule {}
