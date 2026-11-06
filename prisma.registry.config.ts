import { defineConfig } from 'prisma/config';
import { mysqlUrl } from './prisma/load-env.mjs';

export default defineConfig({
  schema: 'prisma/registry/schema.prisma',
  migrations: { path: 'prisma/registry/migrations' },
  datasource: {
    url: mysqlUrl(process.env.MYSQL_REGISTRY_DATABASE || 'judicia_registry'),
  },
});
