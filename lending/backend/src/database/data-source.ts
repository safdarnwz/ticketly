import 'reflect-metadata';
import { join } from 'path';
import { DataSource, DataSourceOptions } from 'typeorm';
import { ENTITIES } from '../entities';

export const dataSourceOptions = (url = process.env.DATABASE_URL ?? 'postgres://lending:lending@localhost:5432/lending'): DataSourceOptions => ({
  type: 'postgres',
  url,
  entities: ENTITIES,
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
  synchronize: false,
});

export default new DataSource(dataSourceOptions());
