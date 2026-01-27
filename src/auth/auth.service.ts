import { Injectable, BadRequestException, UnauthorizedException, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { FirebaseService } from './firebase/firebase.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyTokenDto } from './dto/verify-token.dto';
import { User } from '../users/entities/user.entity';

@Injectable()
export class AuthService {
    constructor(
        private firebaseService: FirebaseService,
        @InjectRepository(User)
        private readonly userRepository: Repository<User>,
        private readonly dataSource: DataSource,
    ) { }

    async register(registerDto: RegisterDto) {
        const queryRunner = this.dataSource.createQueryRunner();
        await queryRunner.connect();
        await queryRunner.startTransaction();

        let firebaseUserRecord: any = null;

        try {
            const auth = this.firebaseService.getAuth();

            // Проверяем, существует ли пользователь в БД
            const existingUser = await this.userRepository.findOne({
                where: { email: registerDto.email },
            });

            if (existingUser) {
                throw new BadRequestException('Пользователь с таким email уже существует');
            }

            // Создаем пользователя в Firebase
            firebaseUserRecord = await auth.createUser({
                email: registerDto.email,
                password: registerDto.password,
                displayName: registerDto.name,
                emailVerified: false,
            });

            // Создаем пользователя в БД в транзакции
            const user = queryRunner.manager.create(User, {
                email: registerDto.email,
                name: registerDto.name || firebaseUserRecord.displayName || '',
                firebaseUid: firebaseUserRecord.uid,
            });

            const savedUser = await queryRunner.manager.save(User, user);

            // Коммитим транзакцию
            await queryRunner.commitTransaction();

            // Генерируем custom token для клиента
            const customToken = await auth.createCustomToken(firebaseUserRecord.uid);

            return {
                id: savedUser.id,
                uid: firebaseUserRecord.uid,
                email: firebaseUserRecord.email,
                displayName: firebaseUserRecord.displayName,
                emailVerified: firebaseUserRecord.emailVerified,
                customToken, // Клиент использует этот токен для получения ID token через Firebase SDK
            };
        } catch (error: any) {
            // Откатываем транзакцию
            await queryRunner.rollbackTransaction();

            // Если пользователь был создан в Firebase, удаляем его
            if (firebaseUserRecord?.uid) {
                try {
                    const auth = this.firebaseService.getAuth();
                    await auth.deleteUser(firebaseUserRecord.uid);
                } catch (deleteError) {
                    // Игнорируем ошибки при удалении из Firebase
                }
            }

            if (error.code === 'auth/email-already-exists' || error.message?.includes('уже существует')) {
                throw new BadRequestException('Пользователь с таким email уже существует');
            }
            throw new BadRequestException(error.message || 'Ошибка при регистрации');
        } finally {
            // Освобождаем query runner
            await queryRunner.release();
        }
    }

    async login(loginDto: LoginDto) {
        try {
            const auth = this.firebaseService.getAuth();

            // Получаем пользователя по email
            const user = await auth.getUserByEmail(loginDto.email);

            // Проверяем, существует ли пользователь в БД
            const dbUser = await this.userRepository.findOne({
                where: { firebaseUid: user.uid },
            });

            if (!dbUser) {
                throw new BadRequestException('Пользователь не найден в базе данных');
            }

            // Генерируем custom token для клиента
            const customToken = await auth.createCustomToken(user.uid);

            return {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                emailVerified: user.emailVerified,
                customToken, // Клиент использует этот токен для получения ID token через Firebase SDK
            };
        } catch (error: any) {
            if (error.code === 'auth/user-not-found') {
                throw new BadRequestException('Пользователь с таким email не найден');
            }
            throw new BadRequestException(error.message || 'Ошибка при входе');
        }
    }

    async verifyToken(verifyTokenDto: VerifyTokenDto) {
        try {
            const auth = this.firebaseService.getAuth();
            const decodedToken = await auth.verifyIdToken(verifyTokenDto.idToken);

            const user = await auth.getUser(decodedToken.uid);

            // Получаем пользователя из БД
            const dbUser = await this.userRepository.findOne({
                where: { firebaseUid: decodedToken.uid },
            });

            return {
                uid: user.uid,
                id: dbUser?.id,
                email: user.email,
                displayName: user.displayName,
                emailVerified: user.emailVerified,
            };
        } catch (error: any) {
            throw new UnauthorizedException('Недействительный токен');
        }
    }

    async resetPassword(resetPasswordDto: ResetPasswordDto) {
        try {
            const auth = this.firebaseService.getAuth();
            const user = await auth.getUserByEmail(resetPasswordDto.email);

            // Генерируем ссылку для сброса пароля
            const resetLink = await auth.generatePasswordResetLink(resetPasswordDto.email, {
                url: process.env.CLIENT_URI?.split(',')[0] || 'http://localhost:3000',
                handleCodeInApp: false,
            });

            return {
                message: 'Ссылка для восстановления пароля отправлена на email',
                resetLink, // В продакшене лучше отправлять через email сервис
            };
        } catch (error: any) {
            if (error.code === 'auth/user-not-found') {
                throw new BadRequestException('Пользователь с таким email не найден');
            }
            throw new BadRequestException(error.message || 'Ошибка при восстановлении пароля');
        }
    }

    async verifyAndUpsertUser(idToken: string) {
        const auth = this.firebaseService.getAuth();

        // Верифицируем ID token
        const decodedToken = await auth.verifyIdToken(idToken);
        const firebaseUser = await auth.getUser(decodedToken.uid);

        // Проверяем, существует ли пользователь в БД
        let dbUser = await this.userRepository.findOne({
            where: { firebaseUid: decodedToken.uid },
        });

        // Если пользователя нет в БД, создаем его (регистрация)
        if (!dbUser) {
            const queryRunner = this.dataSource.createQueryRunner();
            await queryRunner.connect();
            await queryRunner.startTransaction();

            try {
                dbUser = queryRunner.manager.create(User, {
                    email: firebaseUser.email || '',
                    name: firebaseUser.displayName || '',
                    firebaseUid: decodedToken.uid,
                });

                dbUser = await queryRunner.manager.save(User, dbUser);
                await queryRunner.commitTransaction();
            } catch (error) {
                await queryRunner.rollbackTransaction();
                throw new BadRequestException('Ошибка при создании пользователя в БД');
            } finally {
                await queryRunner.release();
            }
        }

        return {
            id: dbUser.id,
            uid: decodedToken.uid,
            email: firebaseUser.email,
            displayName: firebaseUser.displayName,
            emailVerified: firebaseUser.emailVerified,
        };
    }

    async createSessionCookie(idToken: string) {
        const auth = this.firebaseService.getAuth();

        // Создаем session cookie (действует 5 дней)
        const expiresIn = 60 * 60 * 24 * 5 * 1000; // 5 дней в миллисекундах
        const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });

        return {
            sessionCookie,
            expiresIn,
        };
    }

    async getUserByUid(uid: string) {
        try {
            const auth = this.firebaseService.getAuth();
            const user = await auth.getUser(uid);

            return {
                uid: user.uid,
                email: user.email,
                displayName: user.displayName,
                emailVerified: user.emailVerified,
                createdAt: user.metadata.creationTime,
            };
        } catch (error: any) {
            throw new BadRequestException('Пользователь не найден');
        }
    }
}
