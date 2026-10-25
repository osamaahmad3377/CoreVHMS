import { Module } from '@nestjs/common';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { PublicWaitingRoomController, WaitingRoomController } from './waiting-room.controller';
import { WaitingRoomService } from './waiting-room.service';

/** Waiting-room TV screen, check-in tablet, and their settings. */
@Module({
  imports: [SchedulingModule, OrganizationsModule],
  controllers: [WaitingRoomController, PublicWaitingRoomController],
  providers: [WaitingRoomService],
})
export class WaitingRoomModule {}
