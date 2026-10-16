import { Module } from '@nestjs/common';
import { OrgBootstrapService } from '../organizations/org-bootstrap.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionService, OrgBootstrapService],
  exports: [SessionService, AuthService, OrgBootstrapService],
})
export class AuthModule {}
