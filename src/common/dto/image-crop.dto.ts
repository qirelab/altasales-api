import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, ValidateNested } from 'class-validator';

export class ImageCropAreaDto {
  @ApiProperty({ example: 120 })
  @IsNumber()
  x: number;

  @ApiProperty({ example: 80 })
  @IsNumber()
  y: number;

  @ApiProperty({ example: 400 })
  @IsNumber()
  width: number;

  @ApiProperty({ example: 400 })
  @IsNumber()
  height: number;
}

export class ImageCropDto {
  @ApiProperty({ example: 0 })
  @IsNumber()
  x: number;

  @ApiProperty({ example: 0 })
  @IsNumber()
  y: number;

  @ApiProperty({ example: 1.5 })
  @IsNumber()
  zoom: number;

  @ApiProperty({ type: ImageCropAreaDto })
  @ValidateNested()
  @Type(() => ImageCropAreaDto)
  croppedArea: ImageCropAreaDto;
}
