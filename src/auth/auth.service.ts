import { Injectable, BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { UserRecord } from 'firebase-admin/auth';
import { DataSource, Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user-role.enum';
import { BalanceService } from '../balance-transactions/balance.service';
import { FirebaseService } from './firebase/firebase.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyTokenDto } from './dto/verify-token.dto';

@Injectable()
export class AuthService {
  constructor(
    private firebaseService: FirebaseService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly dataSource: DataSource,
    private readonly balanceService: BalanceService,
  ) { }

  // TODO: only for testing
  async register(registerDto: RegisterDto) {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    let firebaseUserRecord: UserRecord | null = null;

    try {
      const auth = this.firebaseService.getAuth();

      const existingUser = await this.userRepository.findOne({
        where: { email: registerDto.email },
      });

      if (existingUser) {
        throw new BadRequestException('User with this email already exists');
      }

      firebaseUserRecord = await auth.createUser({
        email: registerDto.email,
        password: registerDto.password,
        displayName: registerDto.name,
        emailVerified: false,
      });

      const user = queryRunner.manager.create(User, {
        email: registerDto.email,
        name: registerDto.name || firebaseUserRecord.displayName || '',
        lastName: registerDto.lastName || '',
        phoneNumber: registerDto.phoneNumber || '',
        firebaseUid: firebaseUserRecord.uid,
      });

      const savedUser = await queryRunner.manager.save(User, user);
      await this.balanceService.creditRegistrationGift(savedUser.id, queryRunner.manager);

      await queryRunner.commitTransaction();

      const customToken = await auth.createCustomToken(firebaseUserRecord.uid);

      return {
        id: savedUser.id,
        uid: firebaseUserRecord.uid,
        email: firebaseUserRecord.email,
        displayName: firebaseUserRecord.displayName,
        emailVerified: firebaseUserRecord.emailVerified,
        role: savedUser.role,
        customToken,
      };
    } catch (error) {
      await queryRunner.rollbackTransaction();

      if (firebaseUserRecord?.uid) {
        const auth = this.firebaseService.getAuth();
        await auth.deleteUser(firebaseUserRecord.uid);
      }

      if (error.code === 'auth/email-already-exists' || error.message?.includes('уже существует')) {
        throw new BadRequestException('User with this email already exists');
      }
      throw new BadRequestException(error.message || 'Registration error');
    } finally {
      await queryRunner.release();
    }
  }

  // TODO: only for testing
  async login(loginDto: LoginDto) {
    try {
      const auth = this.firebaseService.getAuth();

      const user = await auth.getUserByEmail(loginDto.email);

      const dbUser = await this.userRepository.findOne({
        where: { firebaseUid: user.uid },
      });

      if (!dbUser) {
        throw new BadRequestException('User not found in database');
      }

      const customToken = await auth.createCustomToken(user.uid);

      return {
        id: dbUser.id,
        uid: user.uid,
        email: user.email,
        displayName: user.displayName,
        emailVerified: user.emailVerified,
        role: dbUser.role,
        customToken,
      };
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        throw new BadRequestException('User with this email not found');
      }
      throw new BadRequestException(error.message || 'Login error');
    }
  }

  async verifyToken(verifyTokenDto: VerifyTokenDto) {
    try {
      const auth = this.firebaseService.getAuth();
      const decodedToken = await auth.verifyIdToken(verifyTokenDto.idToken);

      const user = await auth.getUser(decodedToken.uid);

      const dbUser = await this.userRepository.findOne({
        where: { firebaseUid: decodedToken.uid },
      });

      return {
        uid: user.uid,
        id: dbUser?.id,
        email: user.email,
        displayName: user.displayName,
        emailVerified: user.emailVerified,
        role: dbUser?.role ?? UserRole.USER,
      };
    } catch (error) {
      if (error.code === 'auth/id-token-expired') {
        throw new UnauthorizedException('Token expired');
      }
      throw new UnauthorizedException('Invalid token');
    }
  }

  async resetPassword(resetPasswordDto: ResetPasswordDto) {
    try {
      const dbUser = await this.userRepository.findOne({
        where: { email: resetPasswordDto.email },
      });
      if (!dbUser) {
        throw new BadRequestException('User with this email not found');
      }

      const auth = this.firebaseService.getAuth();
      await auth.getUserByEmail(resetPasswordDto.email);

      return {
        message: 'User email validated for password reset',
      };
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        throw new BadRequestException('User with this email not found');
      }
      throw new BadRequestException(error.message || 'Password reset error');
    }
  }

  async generateEmailVerificationLink(email: string) {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Endpoint is available only outside production');
    }

    try {
      const auth = this.firebaseService.getAuth();
      await auth.getUserByEmail(email);

      const verificationLink = await auth.generateEmailVerificationLink(email, {
        url: process.env.CLIENT_URI?.split(',')[0] || 'http://localhost:3000',
        handleCodeInApp: false,
      });

      return {
        message: 'Email verification link generated',
        verificationLink,
      };
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        throw new BadRequestException('User with this email not found');
      }
      throw new BadRequestException(error.message || 'Email verification link generation error');
    }
  }

  async verifyAndUpsertUser(idToken: string) {
    const auth = this.firebaseService.getAuth();

    const decodedToken = await auth.verifyIdToken(idToken);
    const firebaseUser = await auth.getUser(decodedToken.uid);

    let dbUser = await this.userRepository.findOne({
      where: { firebaseUid: decodedToken.uid },
    });

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
        await this.balanceService.creditRegistrationGift(dbUser.id, queryRunner.manager);
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        if (error.code === 'auth/email-already-exists' || error.message?.includes('уже существует')) {
          throw new BadRequestException('User with this email already exists');
        }
        throw new BadRequestException('Error creating user in database');
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
      role: dbUser.role,
    };
  }

  async createSessionCookie(idToken: string) {
    const auth = this.firebaseService.getAuth();

    const expiresIn = 60 * 60 * 24 * 5 * 1000;
    const sessionCookie = await auth.createSessionCookie(idToken, { expiresIn });

    return {
      sessionCookie,
      expiresIn,
    };
  }

  async verifySessionCookie(sessionCookie: string) {
    try {
      const auth = this.firebaseService.getAuth();

      const decodedClaims = await auth.verifySessionCookie(sessionCookie, true);

      const firebaseUser = await auth.getUser(decodedClaims.uid);

      const dbUser = await this.userRepository.findOne({
        where: { firebaseUid: decodedClaims.uid },
      });

      if (!dbUser) {
        throw new UnauthorizedException('User not found in database');
      }

      return {
        id: dbUser.id,
        uid: decodedClaims.uid,
        email: firebaseUser.email || '',
        displayName: [dbUser.name, dbUser.lastName].filter(Boolean).join(' ') || firebaseUser.displayName,
        emailVerified: firebaseUser.emailVerified,
        role: dbUser.role,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid session cookie');
    }
  }

}
