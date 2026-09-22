import { Module } from '@nestjs/common';
import { JevProvider } from './jev.provider';
import { JevGateService } from './jev-gate.service';

@Module({
  providers: [JevProvider, JevGateService],
  exports: [JevGateService],
})
export class JevModule {}
