import { Global, Module } from '@nestjs/common';
import { CounterService } from './counter.service';

@Global()
@Module({ providers: [CounterService], exports: [CounterService] })
export class CounterModule {}
