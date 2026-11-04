import { INestApplication, ValidationPipe } from '@nestjs/common';

export function configureApp(app: INestApplication, corsOrigin: string) {
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  app.enableCors({ origin: corsOrigin.split(','), credentials: false });
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  app.setGlobalPrefix('api');
}
