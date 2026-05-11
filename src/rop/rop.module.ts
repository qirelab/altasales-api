import { Module } from '@nestjs/common';
import { RopService } from './rop.service';

@Module({
  providers: [RopService],
  exports: [RopService],
})
export class RopModule {}
