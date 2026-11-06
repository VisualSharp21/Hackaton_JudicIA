import http from 'node:http';
import { port as PORT, databaseConfig as DB } from './config.js';
import { init } from './repository.js';
import { handle } from './api.js';
import { runWithTenantContext } from './tenant-context.js';

try {
  init();
} catch (error) {
  console.error('Falha ao inicializar o banco:', error.message);
  process.exit(1);
}

http
  .createServer((request, response) => {
    void runWithTenantContext(() => handle(request, response));
  })
  .listen(PORT, () => {
    const providerStatus = process.env.JEVMODEL_BASE_URL
      ? 'provedor de decisões configurado'
      : 'sem provedor — classificador local';

    console.log(
      `Pulso TIC disponível em http://localhost:${PORT} (MariaDB ${DB.registryDatabase}; ${providerStatus})`,
    );
  });
