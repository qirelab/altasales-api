import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ExpertsService } from './experts.service';

@ApiTags('experts')
@Controller('experts')
export class ExpertsController {
  constructor(private readonly expertsService: ExpertsService) { }

  @Get('positions')
  @ApiOperation({ summary: 'List expert positions (role groups)' })
  @ApiResponse({ status: 200, description: 'Four positions with name and description' })
  async listPositions() {
    return this.expertsService.findAllPositions();
  }

  @Get('positions/:id')
  @ApiOperation({ summary: 'Expert position details with offerings and executors' })
  @ApiParam({ name: 'id', description: 'Position ID' })
  @ApiResponse({ status: 200, description: 'Position with offerings and executor-specific prices' })
  @ApiResponse({ status: 404, description: 'Position not found' })
  async getPosition(@Param('id', ParseUUIDPipe) id: string) {
    return this.expertsService.findPositionById(id);
  }
}
