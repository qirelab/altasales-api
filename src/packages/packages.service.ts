import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { CreatePackageDto } from './dto/create-package.dto';
import { UpdatePackageDto } from './dto/update-package.dto';
import { ServicePackage } from './entities/package.entity';
import { Service } from '../services/entities/service.entity';
import { Category } from '../services/entities/category.entity';
import { ServiceType } from '../services/entities/service-type.enum';

@Injectable()
export class PackagesService {
  constructor(
    @InjectRepository(ServicePackage)
    private readonly packageRepository: Repository<ServicePackage>,
    @InjectRepository(Service)
    private readonly serviceRepository: Repository<Service>,
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
  ) { }

  async create(createPackageDto: CreatePackageDto): Promise<ServicePackage> {
    if (createPackageDto.categoryId) {
      await this.ensureCategoryExists(createPackageDto.categoryId);
    }

    const services = await this.resolvePackageServices(createPackageDto.serviceIds);

    const servicePackage = this.packageRepository.create({
      ...createPackageDto,
      tags: createPackageDto.tags ?? [],
      services,
    });

    return this.packageRepository.save(servicePackage);
  }

  async findAll(): Promise<ServicePackage[]> {
    return this.packageRepository.find({
      relations: ['category'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<ServicePackage> {
    const servicePackage = await this.packageRepository.findOne({
      where: { id },
      relations: ['category'],
    });

    if (!servicePackage) {
      throw new NotFoundException(`Пакет с ID ${id} не найден`);
    }

    return servicePackage;
  }

  async update(id: string, updatePackageDto: UpdatePackageDto): Promise<ServicePackage> {
    const servicePackage = await this.findOne(id);
    const { serviceIds, ...packageFields } = updatePackageDto;

    if (packageFields.categoryId) {
      await this.ensureCategoryExists(packageFields.categoryId);
    }

    const services = serviceIds !== undefined
      ? await this.resolvePackageServices(serviceIds)
      : servicePackage.services;

    Object.assign(servicePackage, {
      ...packageFields,
      services,
    });

    if (updatePackageDto.tags === undefined && !servicePackage.tags) {
      servicePackage.tags = [];
    }

    return this.packageRepository.save(servicePackage);
  }

  async remove(id: string): Promise<void> {
    const servicePackage = await this.findOne(id);
    await this.packageRepository.remove(servicePackage);
  }

  private async ensureCategoryExists(categoryId: string): Promise<void> {
    const category = await this.categoryRepository.findOne({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundException(`Категория с ID ${categoryId} не найдена`);
    }
  }

  private async resolvePackageServices(serviceIds?: string[]): Promise<Service[]> {
    if (!serviceIds || serviceIds.length === 0) {
      return [];
    }

    const services = await this.serviceRepository.find({
      where: {
        id: In(serviceIds),
      },
    });
    const serviceIdsSet = new Set(services.map((service) => service.id));
    const missingIds = serviceIds.filter((id) => !serviceIdsSet.has(id));

    if (missingIds.length > 0) {
      throw new NotFoundException(`Услуги с ID ${missingIds.join(', ')} не найдены`);
    }

    const invalidServiceIds = services
      .filter((service) => service.type !== ServiceType.Service)
      .map((service) => service.id);

    if (invalidServiceIds.length > 0) {
      throw new ConflictException(
        `В пакет можно добавлять только услуги. Неверные ID: ${invalidServiceIds.join(', ')}`,
      );
    }

    return services;
  }
}
