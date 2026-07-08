import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('app_setting')
export class AppSetting {
  @ApiProperty({ example: 'vatRatePercent' })
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key: string;

  @ApiProperty({ example: '20' })
  @Column({ type: 'varchar', length: 255 })
  value: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
