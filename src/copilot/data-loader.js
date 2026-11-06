/**
 * Carregador do dataset do Copilot Nível 1 (data/copilot-dataset).
 *
 * Fontes (todas lidas do disco, nada inventado em código):
 *   - catalogo-computadores.json ............ 30 estações LAB-PJE-001..030
 *   - inventarios-glpi/LAB-PJE-XXX.json ..... inventário nativo do GLPI Agent
 *   - maquinas/LAB-PJE-XXX.md ............... ficha completa da estação
 *   - chamados-classificados.json ........... 30 precedentes com triagem do Laya
 *   - hermes-memory/ ........................ memória do agente (core, conhecimento, estações, histórico, sessões)
 *
 * Exporta getMachine(id), listMachines() e searchPrecedents(query, category) — e a
 * busca na base procedural usada pela resolução universal.
 */
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns/promises';
import { projectRoot } from '../config.js';
import { buildTfIdfIndex, curatedTermScore, normalize, tokenize } from './text.js';

export const DATASET_DIR = process.env.COPILOT_DATASET_DIR
  ? path.resolve(process.env.COPILOT_DATASET_DIR)
  : path.join(projectRoot, 'data', 'copilot-dataset');
const MEMORY_DIR = path.join(DATASET_DIR, 'hermes-memory');

let cache = null;

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') console.warn(`[copilot] JSON inválido em ${path.relative(projectRoot, file)}: ${error.message}`);
    return fallback;
  }
}

function readText(file, fallback = '') {
  try {
    return fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch {
    return fallback;
  }
}

function listFiles(dir, extension) {
  try {
    return fs.readdirSync(dir).filter((name) => name.endsWith(extension)).sort();
  } catch {
    return [];
  }
}

// ------------------------------------------------------------ memória Hermes --

function loadMemory() {
  const folders = ['core', 'conhecimento', 'estacoes', 'historico-incidentes', 'sessoes'];
  const memory = {};
  for (const folder of folders) {
    memory[folder] = {};
    for (const file of listFiles(path.join(MEMORY_DIR, folder), '.md'))
      memory[folder][file] = readText(path.join(MEMORY_DIR, folder, file));
  }
  return memory;
}

/** Bullets "- **Chave:** valor" de um markdown de perfil. */
function parseBullets(markdown) {
  const fields = {};
  for (const match of markdown.matchAll(/^-\s+\*\*(.+?):\*\*\s*(.+)$/gm)) fields[normalize(match[1])] = match[2].trim();
  return fields;
}

/** Divide por vírgulas que não estão dentro de parênteses. */
function splitList(value = '') {
  const items = [];
  let depth = 0;
  let current = '';
  for (const char of String(value)) {
    if (char === '(') depth++;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      items.push(current);
      current = '';
    } else current += char;
  }
  items.push(current);
  return items
    .map((item) => item.trim().replace(/\.$/, ''))
    .filter(Boolean)
    .map((item) => item.charAt(0).toUpperCase() + item.slice(1));
}

function parseSectorProfiles(memory) {
  const profiles = [];
  for (const [file, markdown] of Object.entries(memory.estacoes || {})) {
    const fields = parseBullets(markdown);
    const title = (markdown.match(/^#\s+PERFIL SETORIAL:\s*(.+)$/m)?.[1] || file).trim();
    profiles.push({
      arquivo: file,
      titulo: title,
      estacoes: (fields['estacoes tipicas'] || '').match(/LAB-PJE-\d{3}/g) || [],
      equipamentos: fields.equipamentos || '',
      atividadesCriticas: fields['atividades criticas'] || '',
      perifericos: splitList(fields['perifericos comuns']),
      prioridadePadrao: fields['prioridade padrao'] || '',
      atencaoEspecial: fields['atencao especial'] || '',
      markdown,
    });
  }
  return profiles;
}

// ------------------------------------------------------------- estações --

function osFamily(name = '') {
  if (/ubuntu|linux|debian|fedora/i.test(name)) return 'linux';
  if (/windows/i.test(name)) return 'windows';
  return 'other';
}

function shortOsName(name = '', version = '') {
  if (/ubuntu/i.test(name)) return `Ubuntu ${String(name).match(/\d{2}\.\d{2}/)?.[0] || version}`.trim();
  const windows = String(name).match(/Windows\s+\d+/i)?.[0];
  return windows ? windows.replace(/^windows/i, 'Windows') : name;
}

function summarizeInventory(inventory) {
  if (!inventory?.content) return null;
  const c = inventory.content;
  const mb = (value) => (Number.isFinite(Number(value)) ? Math.round((Number(value) / 1024) * 10) / 10 : null);
  return {
    deviceid: inventory.deviceid || null,
    tag: inventory.tag || null,
    agente: c.versionclient || null,
    chassis: c.hardware?.chassis_type || null,
    ultimoUsuario: c.hardware?.lastloggeduser || null,
    grupoDeTrabalho: c.hardware?.workgroup || null,
    bios: c.bios ? { fabricante: c.bios.smanufacturer, modelo: c.bios.smodel, serial: c.bios.ssn, patrimonio: c.bios.assettag } : null,
    cpu: c.cpus?.[0] ? { nome: c.cpus[0].name, nucleos: c.cpus[0].corecount ?? c.cpus[0].core, mhz: c.cpus[0].speed } : null,
    memoria: (c.memories || []).map((m) => ({ capacidadeGib: mb(m.capacity), tipo: m.type, slot: m.caption })),
    sistemaOperacional: c.operatingsystem
      ? { nome: c.operatingsystem.full_name, versao: c.operatingsystem.version, kernel: c.operatingsystem.kernel_name, fqdn: c.operatingsystem.fqdn, dominio: c.operatingsystem.dns_domain, fuso: c.operatingsystem.timezone?.name }
      : null,
    armazenamento: (c.storages || []).map((s) => ({ modelo: s.model, interface: s.interface, tamanhoGib: mb(s.disksize), serial: s.serial })),
    unidades: (c.drives || []).map((d) => ({ letra: d.letter || d.volumn || d.mountpoint || '/', sistemaArquivos: d.filesystem, totalGib: mb(d.total), livreGib: mb(d.free) })),
    redes: (c.networks || []).map((n) => ({ descricao: n.description, tipo: n.type, ip: n.ipaddress, mascara: n.ipmask, mac: n.mac, status: n.status })),
    softwares: (c.softwares || []).map((s) => s.name).filter(Boolean),
  };
}

function buildMachine(raw, profiles) {
  const inventory = readJson(path.join(DATASET_DIR, 'inventarios-glpi', `${raw.nome}.json`));
  const inventario = summarizeInventory(inventory);
  const profile = profiles.find((p) => p.estacoes.includes(raw.nome))
    || profiles.find((p) => normalize(p.titulo).includes(normalize(raw.setor).split(' ').at(-1)))
    || null;
  const family = osFamily(raw.sistema_operacional);
  const osShort = shortOsName(raw.sistema_operacional, raw.versao_so);
  const totalGib = Number(raw.disco_gib) || null;
  const freeGib = Number(raw.disco_livre_gib_simulado);
  const freePct = totalGib && Number.isFinite(freeGib) ? Math.round((freeGib / totalGib) * 100) : null;
  const network = inventario?.redes?.[0] || null;
  const softwares = inventario?.softwares?.length
    ? inventario.softwares
    : (readText(path.join(DATASET_DIR, 'maquinas', `${raw.nome}.md`)).match(/Softwares Críticos Instalados:\*\*\s*(.+)/)?.[1] || '')
        .split(',').map((item) => item.trim()).filter(Boolean);
  const isHearingRoom = /audi[eê]ncia/i.test(raw.setor);
  return Object.freeze({
    id: raw.nome,
    nome: raw.nome,
    patrimonio: raw.patrimonio,
    serial: raw.serial,
    uuid: raw.uuid,
    responsavel: raw.responsavel_ficticio,
    unidade: raw.unidade,
    setor: raw.setor,
    fabricante: raw.fabricante,
    modelo: raw.modelo,
    tipo: raw.tipo,
    processador: raw.processador,
    nucleos: raw.nucleos,
    frequenciaMhz: raw.frequencia_base_mhz,
    memoriaGib: raw.memoria_gib,
    disco: {
      totalGib,
      livreGib: Number.isFinite(freeGib) ? freeGib : null,
      livrePct: freePct,
      alerta: freePct !== null && freePct < 10,
    },
    so: {
      nome: raw.sistema_operacional,
      versao: raw.versao_so,
      arquitetura: raw.arquitetura,
      familia: family,
      curto: osShort,
    },
    rede: {
      ip: raw.ip_documentacao,
      mac: raw.mac,
      tipo: network?.tipo || null,
      descricao: network?.descricao || null,
      fqdn: inventario?.sistemaOperacional?.fqdn || null,
      dominio: inventario?.sistemaOperacional?.dominio || null,
    },
    softwares,
    perifericos: profile?.perifericos || [],
    perfil: profile
      ? {
          arquivo: profile.arquivo,
          titulo: profile.titulo,
          atividadesCriticas: profile.atividadesCriticas,
          prioridadePadrao: profile.prioridadePadrao,
          atencaoEspecial: profile.atencaoEspecial,
        }
      : null,
    inventarioGlpi: inventario,
    salaDeAudiencia: isHearingRoom,
    chip: `${raw.nome} - ${raw.setor} (${raw.fabricante} ${String(raw.modelo || '').split(' ')[0]} / ${osShort})`,
    origem: raw.origem || null,
  });
}

// --------------------------------------------------------- base procedural --

const OS_PREFIX_LINUX = /^(?:se\s+for\s+linux|no\s+linux|no\s+ubuntu|em\s+linux|linux\s*\(ubuntu\)|ubuntu\s*:)/i;
const OS_PREFIX_WINDOWS = /^(?:se\s+for\s+windows|no\s+windows|em\s+windows|windows\s*:)/i;

function variantFromHeading(heading) {
  const tag = normalize(heading.match(/\(([^)]+)\)/)?.[1] || '');
  if (!tag || /todos/.test(tag)) return 'todos';
  if (/ubuntu|linux/.test(tag)) return 'linux';
  if (/windows/.test(tag)) return 'windows';
  return 'todos';
}

/** Extrai itens de lista numerada, mantendo blocos de código indentados junto do passo. */
function parseSteps(lines) {
  const steps = [];
  let current = null;
  let fence = null;
  for (const line of lines) {
    if (fence) {
      if (/^\s*```\s*$/.test(line)) {
        current.codigo = { linguagem: fence.lang, conteudo: fence.lines.join('\n') };
        fence = null;
      } else fence.lines.push(line.replace(/^\s{0,6}/, ''));
      continue;
    }
    const item = line.match(/^\s{0,3}(\d+)\.\s+(.*)$/);
    if (item) {
      current = { texto: item[2].trim(), codigo: null };
      steps.push(current);
      continue;
    }
    const open = line.match(/^\s+```\s*([\w-]*)\s*$/);
    if (open && current) {
      fence = { lang: open[1] || '', lines: [] };
      continue;
    }
    if (current && /^\s{2,}\S/.test(line)) current.texto += ` ${line.trim()}`;
  }
  return steps.map((step) => {
    const so = OS_PREFIX_LINUX.test(step.texto) ? 'linux' : OS_PREFIX_WINDOWS.test(step.texto) ? 'windows' : 'todos';
    return { ...step, so };
  });
}

/** Seções "Sintoma" de um markdown de conhecimento. */
function parseKnowledgeFile(file, markdown) {
  const sections = [];
  const lines = markdown.split(/\r?\n/);
  let section = null;
  let sub = null;
  const flushSub = () => {
    if (!section || !sub) return;
    if (sub.type === 'diagnostico') section.diagnostico = sub.lines.join(' ').replace(/\s+/g, ' ').trim();
    if (sub.type === 'procedimento') section.variantes.push({ so: sub.variant, passos: parseSteps(sub.lines) });
    sub = null;
  };
  for (const line of lines) {
    const h2 = line.match(/^##\s+(.+?)\s*$/);
    if (h2) {
      flushSub();
      const heading = h2[1].match(/^(?:(\d+)\.\s*)?sintoma(?:\s+(\d+))?\s*:\s*(.+)$/i);
      section = heading
        ? { arquivo: file, titulo: heading[3].trim(), ordem: Number(heading[2] || heading[1]) || sections.length + 1, diagnostico: '', variantes: [] }
        : null;
      if (section) sections.push(section);
      continue;
    }
    const h3 = line.match(/^###\s+(.+?)\s*$/);
    if (h3 && section) {
      flushSub();
      const heading = normalize(h3[1]);
      if (heading.startsWith('diagnostico')) sub = { type: 'diagnostico', lines: [] };
      else if (heading.startsWith('procedimento')) sub = { type: 'procedimento', variant: variantFromHeading(h3[1]), lines: [] };
      continue;
    }
    if (/^---\s*$/.test(line)) continue;
    if (sub) sub.lines.push(line);
  }
  flushSub();
  return sections.filter((s) => s.variantes.some((v) => v.passos.length));
}

function loadProcedures(memory) {
  const index = readJson(path.join(MEMORY_DIR, 'conhecimento', 'indice.json'), { procedimentos: [] });
  const sections = [];
  for (const [file, markdown] of Object.entries(memory.conhecimento || {})) sections.push(...parseKnowledgeFile(file, markdown));
  const used = new Set();
  const procedures = [];
  for (const entry of index.procedimentos || []) {
    const key = normalize(entry.secao).replace(/["']/g, '');
    const section = sections.find((s) => s.arquivo === entry.arquivo && normalize(s.titulo).replace(/["']/g, '').startsWith(key));
    if (!section) {
      console.warn(`[copilot] indice.json: seção "${entry.secao}" não encontrada em ${entry.arquivo}.`);
      continue;
    }
    used.add(section);
    procedures.push({ ...entry, so: entry.so || ['windows', 'linux'], ...pickSection(section) });
  }
  // Seções sem entrada no índice continuam disponíveis, indexadas pelo título.
  for (const section of sections) {
    if (used.has(section)) continue;
    const id = `${section.arquivo.replace(/\.md$/, '')}-${section.ordem}`;
    procedures.push({ id, arquivo: section.arquivo, grupo: id, so: ['windows', 'linux'], fortes: [], termos: [], ...pickSection(section) });
  }
  return procedures;
}

function pickSection(section) {
  return {
    titulo: section.titulo,
    diagnostico: section.diagnostico,
    variantes: section.variantes,
    fonte: `${section.arquivo} › Sintoma ${section.ordem}`,
    textoBusca: [section.titulo, section.titulo, section.diagnostico].join(' '),
  };
}

/** Passos de um procedimento para a família de SO da estação (null se não houver passos aplicáveis). */
export function stepsForOs(procedure, family) {
  const exact = procedure.variantes.find((v) => v.so === family);
  const generic = procedure.variantes.find((v) => v.so === 'todos');
  const chosen = exact || (procedure.so.includes(family) ? generic : null);
  if (!chosen) return null;
  const steps = chosen.passos.filter((step) => step.so === 'todos' || step.so === family);
  return steps.length ? steps : null;
}

// ------------------------------------------------------------- precedentes --

/** "### Precedente N: título (Casos CHAM-004, CHAM-009)" em incidentes-recorrentes.md. */
function parseRecurringPatterns(memory) {
  const markdown = memory['historico-incidentes']?.['incidentes-recorrentes.md'] || '';
  const patterns = [];
  const blocks = markdown.split(/^###\s+/m).slice(1);
  for (const block of blocks) {
    const [headingLine, ...rest] = block.split(/\r?\n/);
    const heading = headingLine.match(/^Precedente\s+(\d+):\s*(.+?)\s*\(Casos?\s+([^)]+)\)\s*$/i);
    if (!heading) continue;
    const body = rest.join('\n');
    const cause = body.match(/\*\*Causa Raiz:\*\*\s*(.+)/)?.[1]?.trim() || '';
    const resolutionBlock = body.split(/\*\*Resolução Comprovada:\*\*/)[1] || '';
    const steps = [];
    let rate = null;
    for (const line of resolutionBlock.split(/\r?\n/)) {
      const item = line.match(/^\s*\d+\.\s+(.+)$/);
      if (!item) continue;
      const rateMatch = item[1].match(/taxa de resolu[cç][aã]o[^:]*:\s*([\d.,]+\s*%)/i);
      if (rateMatch) rate = rateMatch[1].replace(/\s+/g, '');
      else steps.push(item[1].trim());
    }
    patterns.push({
      numero: Number(heading[1]),
      titulo: heading[2].trim(),
      casos: (heading[3].match(/CHAM-\d+/g) || []).map((id) => id.replace(/^CHAM-(\d+)$/, (_, n) => n.padStart(3, '0'))),
      causaRaiz: cause,
      resolucao: steps,
      taxaAutoatendimento: rate,
      fonte: `incidentes-recorrentes.md › Precedente ${heading[1]}`,
    });
  }
  return patterns;
}

function buildPrecedents(raw, patterns, procedures, machinesById) {
  return (raw || []).map((item) => {
    const number = String(item.id || '').match(/(\d{3})$/)?.[1] || '';
    const pattern = patterns.find((p) => p.casos.includes(number)) || null;
    const machine = machinesById.get(item.computador?.nome) || null;
    const text = `${item.titulo}. ${item.relato}`;
    const procedureMatch = rankProcedures(procedures, text, { machine, limit: 1 })[0] || null;
    const cls = item.classificacao || {};
    return Object.freeze({
      id: item.id,
      numero: number,
      titulo: item.titulo,
      relato: item.relato,
      estacao: {
        nome: item.computador?.nome,
        setor: item.computador?.setor,
        unidade: item.computador?.unidade,
        modelo: item.computador?.modelo,
        so: item.computador?.sistema_operacional,
        familiaSo: osFamily(item.computador?.sistema_operacional),
      },
      contexto: item.detalhes_contexto || {},
      classificacao: {
        categoria: cls.categoria || null,
        sistema: cls.sistema || null,
        impacto: cls.impacto || null,
        urgencia: cls.urgencia || null,
        prioridade: cls.prioridade_calculada || null,
        fila: cls.fila_sugerida || null,
        possivelIncidente: cls.possivel_incidente === true,
        statusTriagem: cls.status_triagem || null,
        provedor: cls.provedor || null,
        confianca: cls.confianca_geral || null,
      },
      padrao: pattern,
      procedimento: procedureMatch && procedureMatch.score >= 3
        ? { id: procedureMatch.procedure.id, titulo: procedureMatch.procedure.titulo, fonte: procedureMatch.procedure.fonte }
        : null,
      tokens: [...tokenize(item.titulo), ...tokenize(item.titulo), ...tokenize(item.relato)],
    });
  });
}

// ------------------------------------------------------------------ cache --

function load() {
  if (cache) return cache;
  const memory = loadMemory();
  const profiles = parseSectorProfiles(memory);
  const machines = (readJson(path.join(DATASET_DIR, 'catalogo-computadores.json'), []) || []).map((raw) => buildMachine(raw, profiles));
  const machinesById = new Map(machines.map((m) => [m.id, m]));
  const procedures = loadProcedures(memory);
  const patterns = parseRecurringPatterns(memory);
  const precedents = buildPrecedents(readJson(path.join(DATASET_DIR, 'chamados-classificados.json'), []), patterns, procedures, machinesById);
  const precedentIndex = buildTfIdfIndex(precedents.map((p) => p.tokens));
  const procedureIndex = buildTfIdfIndex(procedures.map((p) => tokenize(p.textoBusca)));
  cache = { memory, profiles, machines, machinesById, procedures, procedureIndex, patterns, precedents, precedentIndex };
  return cache;
}

/** Recarrega o dataset do disco (útil em testes e após editar a memória). */
export function reloadDataset() {
  cache = null;
  return datasetSummary();
}

export function datasetSummary() {
  const data = load();
  return {
    diretorio: path.relative(projectRoot, DATASET_DIR) || DATASET_DIR,
    estacoes: data.machines.length,
    precedentes: data.precedents.length,
    padroesRecorrentes: data.patterns.length,
    procedimentos: data.procedures.length,
    memoria: Object.fromEntries(Object.entries(data.memory).map(([folder, files]) => [folder, Object.keys(files).length])),
  };
}

// ------------------------------------------------------------ API pública --

export function listMachines() {
  return load().machines;
}

export function getMachine(id) {
  return load().machinesById.get(String(id || '').trim().toUpperCase()) || null;
}

/** Memória Hermes completa (markdown por pasta/arquivo). */
export function loadHermesMemory() {
  return load().memory;
}

export function listRecurringPatterns() {
  return load().patterns;
}

export function listProcedures() {
  return load().procedures;
}

export function getProcedure(id) {
  return load().procedures.find((p) => p.id === id) || null;
}

function rankProcedures(procedures, text, { machine = null, decision = null, limit = 5, index = null } = {}) {
  const normalized = normalize(text);
  const family = machine?.so?.familia || 'windows';
  const lexical = index ? index.similarities(tokenize(text)) : null;
  const ranked = procedures.map((procedure, position) => {
    if (procedure.busca === false) return { procedure, score: 0, matched: [] };
    const curated = curatedTermScore(normalized, procedure.fortes, procedure.termos);
    const base = curated.points + (lexical ? lexical[position].score * 6 : 0);
    // Reforços só desempatam: sem evidência no texto, o procedimento não entra.
    let score = base;
    if (base > 0) {
      if (decision?.category && procedure.categoria === decision.category) score += 0.6;
      if (decision?.system && procedure.sistema === decision.system) score += 0.4;
      if (procedure.equipamento && machine?.tipo) score += procedure.equipamento === machine.tipo ? 1 : -1.5;
      if (procedure.so.length === 1 && procedure.so[0] === family) score += 0.5; // variante dedicada ao SO
    }
    return { procedure, score, matched: curated.matched };
  });
  return ranked.filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Procedimentos da base procedural mais aderentes ao relato, já resolvidos para o
 * SO da estação: se o melhor procedimento não tem passos para o SO, usa a variante
 * do mesmo grupo (ex.: spooler do Windows ➔ CUPS no Ubuntu).
 */
export function searchKnowledge(text, { machine = null, decision = null, limit = 3, exclude = [], minScore = 2, minAlternativeScore = 2.5, minRelativeScore = 0.25 } = {}) {
  const data = load();
  const family = machine?.so?.familia || 'windows';
  const ranked = rankProcedures(data.procedures, text, { machine, decision, limit: data.procedures.length, index: data.procedureIndex });
  const scoreOf = new Map(ranked.map((r) => [r.procedure.id, r.score]));
  const topScore = ranked[0]?.score || 0;
  const results = [];
  const seenGroups = new Set();
  for (const { procedure, score, matched } of ranked) {
    if (seenGroups.has(procedure.grupo)) continue;
    // Alternativas precisam ser aderentes de verdade: piso absoluto e fração do melhor resultado.
    if (score < (results.length || exclude.length ? minAlternativeScore : minScore) || score < topScore * minRelativeScore) break;
    let chosen = procedure;
    let steps = stepsForOs(procedure, family);
    if (!steps) {
      // Variante do mesmo grupo para o SO da estação, preferindo a mais aderente ao relato.
      const siblings = data.procedures
        .filter((p) => p.grupo === procedure.grupo && p.id !== procedure.id && stepsForOs(p, family))
        .sort((a, b) => (scoreOf.get(b.id) || 0) - (scoreOf.get(a.id) || 0));
      if (siblings[0]) {
        chosen = siblings[0];
        steps = stepsForOs(chosen, family);
      }
    }
    seenGroups.add(procedure.grupo);
    if (!steps || exclude.includes(chosen.id)) continue;
    results.push({ procedure: chosen, steps, score: Math.round(score * 100) / 100, matched });
    if (results.length >= limit) break;
  }
  return results;
}

/**
 * RAG de precedentes: similaridade TF-IDF (cosseno) entre o relato e os 30 chamados
 * classificados, com reforço por categoria/sistema do Laya, setor e SO da estação.
 * `similaridade` exibida é o cosseno léxico (0–100), sem os reforços.
 */
export function searchPrecedents(query, category = null, { system = null, machine = null, limit = 3, minSimilarity = 0.18, procedureIds = [] } = {}) {
  const data = load();
  const queryTokens = tokenize(query);
  if (!queryTokens.length) return [];
  const sims = data.precedentIndex.similarities(queryTokens);
  // Mesmo sintoma da base procedural (o identificado no relato ou exigido pelo laudo).
  const groups = new Set(procedureIds.map((id) => data.procedures.find((p) => p.id === id)?.grupo).filter(Boolean));
  return data.precedents
    .map((precedent, position) => {
      const { score, shared } = sims[position];
      let rank = score;
      const precedentGroup = precedent.procedimento ? data.procedures.find((p) => p.id === precedent.procedimento.id)?.grupo : null;
      if (precedentGroup && groups.has(precedentGroup)) rank += 0.12;
      if (category && precedent.classificacao.categoria === category) rank += 0.05;
      if (system && precedent.classificacao.sistema === system) rank += 0.04;
      if (machine?.setor && precedent.estacao.setor === machine.setor) rank += 0.03;
      if (machine?.so?.familia && precedent.estacao.familiaSo === machine.so.familia) rank += 0.02;
      if (machine?.id && precedent.estacao.nome === machine.id) rank += 0.02;
      return { precedent, score, rank, shared };
    })
    .filter((r) => r.score >= minSimilarity)
    .sort((a, b) => b.rank - a.rank)
    .slice(0, limit)
    .map(({ precedent, score, shared }) => {
      const { tokens, ...rest } = precedent;
      return { ...rest, similaridade: Math.round(score * 100), termosEmComum: [...new Set(shared)].slice(0, 8) };
    });
}

// ------------------------------------------------ identificação da estação --

function normalizeIp(ip = '') {
  return String(ip).trim().replace(/^::ffff:/i, '');
}

function isLoopback(ip) {
  return /^(127\.|::1$|localhost$)/i.test(ip);
}

/**
 * Vincula a sessão à estação pela rede interna: IP do cliente contra o catálogo e o
 * inventário GLPI; se não casar, tenta o nome reverso (DNS) contra hostname/FQDN.
 */
export async function detectStation(clientIp, { timeoutMs = 400 } = {}) {
  const ip = normalizeIp(clientIp);
  if (!ip) return null;
  const machines = listMachines();
  const byIp = machines.find((m) => m.rede.ip === ip || m.inventarioGlpi?.redes?.some((n) => n.ip === ip));
  if (byIp) return { machineId: byIp.id, metodo: 'ip', valor: ip };
  if (isLoopback(ip)) return null;
  let names = [];
  try {
    names = await Promise.race([
      dns.reverse(ip),
      new Promise((resolve) => setTimeout(() => resolve([]), timeoutMs)),
    ]);
  } catch {
    names = [];
  }
  for (const name of names) {
    const host = String(name).toLowerCase().replace(/\.$/, '');
    const short = host.split('.')[0];
    const match = machines.find((m) => m.rede.fqdn?.toLowerCase() === host || m.id.toLowerCase() === short);
    if (match) return { machineId: match.id, metodo: 'hostname', valor: host };
  }
  return null;
}

/** Procura estação pelo nome do computador informado (ex.: pré-diagnóstico local). */
export function findMachineByHostname(hostname) {
  const short = String(hostname || '').trim().toLowerCase().split('.')[0];
  if (!short) return null;
  return listMachines().find((m) => m.id.toLowerCase() === short || m.rede.fqdn?.toLowerCase().split('.')[0] === short) || null;
}
