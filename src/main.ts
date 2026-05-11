import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { IoAdapter } from '@nestjs/platform-socket.io';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const trustedOrigins = new Set([
    'https://staging.altasales.qirelab.com',
    'https://altasales.qirelab.com',
    'https://api.staging.altasales.qirelab.com',
    'https://api.altasales.qirelab.com',
  ]);
  const localhostOriginPattern = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i;

  app.useWebSocketAdapter(new IoAdapter(app));
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const config = new DocumentBuilder()
    .setTitle('Altasales API')
    .setDescription('Altasales API documentation')
    .setVersion('1.0')
    .addCookieAuth('session', {
      type: 'http',
      in: 'Cookie',
      scheme: 'Bearer',
    })
    .build();
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }

      const normalizedOrigin = origin.replace(/\/$/, '');
      const isTrustedOrigin =
        trustedOrigins.has(normalizedOrigin) || localhostOriginPattern.test(normalizedOrigin);

      if (isTrustedOrigin) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
  });
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  await app.listen(process.env.PORT ?? 4000);
}
bootstrap();
