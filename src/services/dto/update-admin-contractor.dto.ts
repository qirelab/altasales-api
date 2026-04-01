import { PartialType } from '@nestjs/swagger';
import { CreateAdminContractorDto } from './create-admin-contractor.dto';

export class UpdateAdminContractorDto extends PartialType(CreateAdminContractorDto) {}
