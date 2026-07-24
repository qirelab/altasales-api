import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { RopModule } from '../rop/rop.module';
import { User } from '../users/entities/user.entity';
import { FileEntity } from './entities/file.entity';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([FileEntity, User]),
    AuthModule,
    RopModule,
  ],
  controllers: [FilesController],
  providers: [FilesService],
  exports: [FilesService],
})
export class FilesModule {}
