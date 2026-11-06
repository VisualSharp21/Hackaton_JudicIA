import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { init, createTenant } from '../src/repository.js';
import { createUser } from '../src/auth.js';
import { setTenantContext } from '../src/tenant-context.js';

function askHidden(label) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function') throw new Error('Execute em um terminal interativo para informar a senha com seguranca.');
  stdout.write(label);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => { stdin.off('data', onData); stdin.setRawMode(false); stdout.write('\n'); error ? reject(error) : resolve(value); };
    const onData = (chunk) => {
      for (const character of chunk.toString()) {
        if (character === '\u0003') return finish(new Error('Operacao cancelada.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u0008' || character === '\u007f') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    stdin.on('data', onData);
  });
}

async function ask(label) {
  const input = createInterface({ input: stdin, output: stdout });
  try { return await input.question(label); } finally { input.close(); }
}

async function main() {
  init();
  const [action = 'create'] = process.argv.slice(2);
  if (action !== 'create') throw new Error('Acao disponivel: create.');
  const name = await ask('Nome da organizacao: ');
  const slug = await ask('Identificador curto (ex.: empresa-exemplo): ');
  const managerName = await ask('Nome do primeiro gestor: ');
  const email = await ask('E-mail do primeiro gestor: ');
  const password = await askHidden('Senha inicial (minimo 12 caracteres): ');
  const confirmation = await askHidden('Confirme a senha: ');
  if (password !== confirmation) throw new Error('As senhas nao conferem.');
  const tenant = createTenant({ name, slug });
  setTenantContext(tenant.id);
  const manager = await createUser({ email, displayName: managerName, role: 'gestor', password, tenantId: tenant.id });
  stdout.write(`Organizacao ${tenant.name} criada. Identificador de login: ${tenant.slug}. Primeiro gestor: ${manager.email}.\n`);
}

main().catch((error) => { stdout.write(`Erro: ${error.message}\n`); process.exitCode = 1; });
