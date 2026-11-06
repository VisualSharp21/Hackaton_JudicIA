import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  createUser,
  resetUserPassword,
  updateUserRole,
} from '../src/auth.js';
import { init, tenantBySlug } from '../src/repository.js';
import { setTenantContext } from '../src/tenant-context.js';

function askHidden(prompt) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== 'function')
    throw new Error('Execute este comando em um terminal interativo para informar senhas com segurança.');
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = (error) => {
      stdin.off('data', onData);
      stdin.setRawMode(false);
      stdout.write('\n');
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk.toString()) {
        if (character === '\u0003') return finish(new Error('Operação cancelada.'));
        if (character === '\r' || character === '\n') return finish();
        if (character === '\u0008' || character === '\u007f') value = value.slice(0, -1);
        else if (character >= ' ') value += character;
      }
    };
    stdin.on('data', onData);
  });
}

async function askVisible(promptText) {
  const prompt = createInterface({ input: stdin, output: stdout });
  try {
    return await prompt.question(promptText);
  } finally {
    prompt.close();
  }
}

async function readNewPassword() {
  const password = await askHidden('Nova senha (mínimo 12 caracteres): ');
  const confirmation = await askHidden('Confirme a senha: ');
  if (password !== confirmation) throw new Error('As senhas não conferem.');
  return password;
}

async function main() {
  init();
  const [action = 'create', ...args] = process.argv.slice(2);
  const tenantArgument = args.indexOf('--tenant');
  const tenantSlug = tenantArgument >= 0 ? args[tenantArgument + 1] : 'default';
  if (tenantArgument >= 0) args.splice(tenantArgument, 2);
  const tenant = tenantBySlug(tenantSlug);
  if (!tenant) throw new Error('Organizacao nao encontrada. Crie-a com npm run tenants -- create.');
  setTenantContext(tenant.id);
  if (action === 'create') {
    const email = await askVisible('E-mail: ');
    const displayName = await askVisible('Nome exibido: ');
    const role = await askVisible('Perfil (solicitante/tic/gestor): ');
    const password = await readNewPassword();
    const user = await createUser({ email, displayName, role, password, tenantId: tenant.id });
    stdout.write(`Conta criada: ${user.email} · perfil ${user.role}\n`);
    return;
  }
  if (action === 'reset-password') {
    const email = args[0] || (await askVisible('E-mail da conta: '));
    await resetUserPassword(email, await readNewPassword());
    stdout.write('Senha redefinida; as sessões existentes foram encerradas.\n');
    return;
  }
  if (action === 'set-role') {
    if (args.length !== 2) throw new Error('Uso: npm run users -- set-role --tenant slug email solicitante|tic|gestor');
    updateUserRole(args[0], args[1]);
    stdout.write('Perfil atualizado; as sessões existentes foram encerradas.\n');
    return;
  }
  throw new Error('Ações: create, reset-password, set-role.');
}

main().catch((error) => {
  stdout.write(`Erro: ${error.message}\n`);
  process.exitCode = 1;
});
