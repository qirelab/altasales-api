import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateServiceDto } from './dto/create-service.dto';
import { UpdateServiceDto } from './dto/update-service.dto';
import { GetServicesQueryDto } from './dto/get-services-query.dto';
import { Service } from './entities/service.entity';

@Injectable()
export class ServicesService {
  constructor(
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
  ) {}

  async create(createServiceDto: CreateServiceDto): Promise<Service> {
    const service = this.serviceRepository.create({
      ...createServiceDto,
      skills: createServiceDto.skills ?? [],
    });
    return await this.serviceRepository.save(service);
  }

  async findAll(query: GetServicesQueryDto): Promise<Service[]> {
    const qb = this.serviceRepository.createQueryBuilder('service');

    if (query.name?.trim()) {
      qb.andWhere('service.name ILIKE :name', {
        name: `%${query.name.trim()}%`,
      });
    }
    if (query.type) {
      qb.andWhere('service.type = :type', { type: query.type });
    }
    if (query.category) {
      qb.andWhere('service.category = :category', { category: query.category });
    }
    if (query.dateOrder) {
      qb.orderBy('service.createdAt', query.dateOrder === 'asc' ? 'ASC' : 'DESC');
    }
    if (query.priceOrder) {
      if (query.dateOrder) {
        qb.addOrderBy('service.price', query.priceOrder === 'asc' ? 'ASC' : 'DESC');
      } else {
        qb.orderBy('service.price', query.priceOrder === 'asc' ? 'ASC' : 'DESC');
      }
    }

    return await qb.getMany();
  }

  async findOne(id: number): Promise<Service> {
    const service = await this.serviceRepository.findOne({ where: { id } });
    if (!service) {
      throw new NotFoundException(`Услуга с ID ${id} не найдена`);
    }
    return service;
  }

  async update(id: number, updateServiceDto: UpdateServiceDto): Promise<Service> {
    const service = await this.findOne(id);
    Object.assign(service, updateServiceDto);
    return await this.serviceRepository.save(service);
  }

  async remove(id: number): Promise<void> {
    const service = await this.findOne(id);
    await this.serviceRepository.remove(service);
  }
}
