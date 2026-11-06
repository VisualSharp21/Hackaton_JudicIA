import { classifyWithProvider } from './src/decision-provider.js';
import { decisionQuestions, routeQueue } from './src/triage.js';
import dotenv from 'dotenv';

dotenv.config(); // Carrega as variáveis do .env

async function run() {
  try {
    const texto = 'Minha conta do PJe não está conectando a internet';
    console.log(`Testando a frase: "${texto}"\n`);
    
    const result = await classifyWithProvider(texto, decisionQuestions);
    result.fila_calculada = routeQueue(result.decision);
    
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error('Erro:', e.message);
  }
}
run();
