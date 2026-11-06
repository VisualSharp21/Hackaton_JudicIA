import { defineConfig } from 'prisma/config';
import { mysqlUrl } from './prisma/load-env.mjs';

export default defineConfig({
  schema: 'prisma/tenant/schema.prisma',
  migrations: { path: 'prisma/tenant/migrations' },
  datasource: {
    url: mysqlUrl(process.env.PRISMA_DATABASE_NAME || 'judicia_t_00000000000040008000000000000001'),
  },
});
