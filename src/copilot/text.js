/**
 * Utilidades de texto em português para a busca determinística do Copilot
 * (precedentes e base procedural). Sem dependências: normalização, frases-chave,
 * stopwords, um stemmer leve e conceitos do domínio de TIC forense.
 */

/** Minúsculas, sem acentos, aspas tipográficas e espaços repetidos. */
export function normalize(text = '') {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[‘’“”`´]/g, "'")
    .replace(/[–—]/g, '-')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const isWordChar = (char) => /[a-z0-9]/.test(char || '');

/**
 * Verifica se o texto normalizado contém o termo (também normalizado) como palavra
 * ou frase inteira. Aceita plural simples no fim ("impressora" casa "impressoras").
 */
export function hasTerm(normalizedText, term) {
  const needle = normalize(term);
  if (!needle) return false;
  let from = 0;
  while (from <= normalizedText.length) {
    const index = normalizedText.indexOf(needle, from);
    if (index === -1) return false;
    const end = index + needle.length;
    const startsOk = !isWordChar(needle[0]) || !isWordChar(normalizedText[index - 1]);
    let endsOk = !isWordChar(needle.at(-1)) || !isWordChar(normalizedText[end]);
    if (!endsOk && isWordChar(needle.at(-1))) {
      const tail = normalizedText.slice(end, end + 2);
      endsOk = (tail[0] === 's' && !isWordChar(tail[1])) || (tail === 'es' && !isWordChar(normalizedText[end + 2]));
    }
    if (startsOk && endsOk) return true;
    from = index + 1;
  }
  return false;
}

// Frases que perdem o sentido quando o "não"/"sem" vira stopword.
const PHRASES = [
  [/\bwi-?fi\b/g, ' wifi '],
  [/\be-?mail(s)?\b/g, ' email '],
  [/\bpje\s*office\b/g, ' pjeoffice '],
  [/\bnao\s+(liga|ligou|acende|inicia|da sinal)\b/g, ' naoliga '],
  [/\b(sem\s+sinal(\s+de\s+video)?|no\s+signal)\b/g, ' semsinal '],
  [/\btela\s+(preta|escura)\b/g, ' telapreta '],
  [/\btela\s+branca|pagina\s+(em\s+)?branca\b/g, ' telabranca '],
  [/\b(nao\s+sai\s+(nenhum\s+)?som|sem\s+som|sem\s+audio)\b/g, ' semsom '],
  [/\b(ninguem\s+(nos\s+)?(ouve|escuta)|nao\s+(nos\s+)?(ouvem|escutam|ouve))\b/g, ' ninguemouve '],
  [/\bfora\s+do\s+ar\b/g, ' foradoar '],
  [/\bsem\s+(internet|rede|conexao)\b/g, ' semrede '],
  [/\bem\s+lote\b/g, ' emlote '],
  [/\bbad\s+gateway\b/g, ' badgateway '],
  [/\bsessao\s+(expirou|expirada|expira)\b/g, ' sessaoexpirada '],
  [/\bsenha\s+(expirou|expirada|vencida|venceu)\b/g, ' senhaexpirada '],
];

const STOPWORDS = new Set(`a o as os um uma uns umas de da do das dos em na no nas nos por pela pelo pelas pelos para pra pro com sem
e ou mas que se ja nao sim muito muita muitos muitas mais menos tambem so apenas ainda quando onde como porque pois entao
eu voce voces ele ela eles elas nos me te lhe meu minha meus minhas seu sua seus suas nosso nossa este esta esse essa isso isto
aquele aquela aquilo aqui ali la ai ate apos antes depois desde sobre entre ao aos à às foi era sao ser estar estou esta estamos estao
tem temos ter tinha fica ficar fica fico vai vou fazer feito faz fiz consigo consegue conseguimos tenho tentei tentando
hoje ontem agora dia vez vezes cada todo toda todos todas nada tudo algo alguem bom boa dia noite tarde favor ola oi
pelo pela seja sejam qual quais quem cujo mesmo mesma outra outro outros outras coisa coisas tipo assim bem mal
the of and to in is it`.split(/\s+/).filter(Boolean));

/** Stemmer leve (remove plural e alguns sufixos comuns) — suficiente para casar "impressoras" com "impressora". */
export function stem(word) {
  let w = word;
  if (w.length <= 3 || /^\d/.test(w)) return w;
  for (const [suffix, replacement] of [['mente', ''], ['coes', 'cao'], ['soes', 'sao'], ['oes', 'ao'], ['aes', 'ao'], ['ais', 'al'], ['eis', 'el'], ['ns', 'm']]) {
    if (w.length > suffix.length + 2 && w.endsWith(suffix)) return w.slice(0, -suffix.length) + replacement;
  }
  if (w.length > 4 && w.endsWith('es') && /[rsz]es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  return w;
}

// Conceitos do domínio: unificam variações para a similaridade (o token original também é mantido).
const CONCEPTS = [
  [/^(imprim|impress)/, 'conceito_impressao'],
  [/^assin/, 'conceito_assinatura'],
  [/^(lent|devag|demor)/, 'conceito_lentidao'],
  [/^(microfon|mic$|jabra)/, 'conceito_microfone'],
  [/^(camera|webcam)/, 'conceito_camera'],
  [/^(wifi|rede|internet|conexa|conect|ethernet|cabo)/, 'conceito_rede'],
  [/^(senha|login|logon|credencia)/, 'conceito_senha'],
  [/^bloque/, 'conceito_bloqueio'],
  [/^(email|zimbra|outlook|correio|mailbox|intimaco)/, 'conceito_email'],
  [/^(token|a3$|safesign|smartcard)/, 'conceito_token'],
  [/^certific/, 'conceito_certificado'],
  [/^(pjeoffice|8800)$/, 'conceito_pjeoffice'],
  [/^(meet|videoconfer|audienc|oitiva|depoiment)/, 'conceito_audiencia'],
  [/^(monitor|hdmi|displayport|semsinal)/, 'conceito_monitor'],
  [/^(teclad|mouse|ponteir)/, 'conceito_teclado_mouse'],
  [/^(scanner|digitaliz)/, 'conceito_scanner'],
  [/^(disco|espaco|armazenament)/, 'conceito_disco'],
  [/^(dns|resolv)/, 'conceito_dns'],
  [/^(vpn|openvpn|tunel)/, 'conceito_vpn'],
  [/^(bateria|carregador|tomada|energia)/, 'conceito_energia'],
  [/^(som|audio|caixa|alto|fone)/, 'conceito_audio'],
  [/^(eco|microfonia|retorno)$/, 'conceito_eco'],
  [/^(pdf|navegador|chrome|firefox)$/, 'conceito_navegador'],
  [/^(ubuntu|linux|terminal|bash|systemd)$/, 'conceito_linux'],
];

/** Tokens para busca: frases-chave, stopwords removidas, stem leve e conceitos do domínio. */
export function tokenize(text = '') {
  let value = normalize(text);
  for (const [pattern, replacement] of PHRASES) value = value.replace(pattern, replacement);
  const words = value.match(/[a-z0-9]+/g) || [];
  const tokens = [];
  for (const raw of words) {
    if (STOPWORDS.has(raw) || (raw.length < 2 && !/\d/.test(raw))) continue;
    const token = stem(raw);
    tokens.push(token);
    for (const [pattern, concept] of CONCEPTS) if (pattern.test(token)) { tokens.push(concept); break; }
  }
  return tokens;
}

/** Conta ocorrências de termos curados (fortes = 3 pontos, comuns = 1). Devolve pontos e termos encontrados. */
export function curatedTermScore(normalizedText, strong = [], common = []) {
  let points = 0;
  const matched = [];
  for (const term of strong) if (hasTerm(normalizedText, term)) { points += 3; matched.push(term); }
  for (const term of common) if (hasTerm(normalizedText, term)) { points += 1; matched.push(term); }
  return { points, matched };
}

/** Índice TF-IDF com similaridade de cosseno (0..1). */
export function buildTfIdfIndex(documents) {
  const df = new Map();
  const termFreqs = documents.map((tokens) => {
    const tf = new Map();
    for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
    for (const token of tf.keys()) df.set(token, (df.get(token) || 0) + 1);
    return tf;
  });
  const total = documents.length || 1;
  const idf = (token) => Math.log(1 + total / (df.get(token) || 0.5));
  const vectors = termFreqs.map((tf) => {
    const vector = new Map();
    let norm = 0;
    for (const [token, count] of tf) {
      const weight = (1 + Math.log(count)) * idf(token);
      vector.set(token, weight);
      norm += weight * weight;
    }
    return { vector, norm: Math.sqrt(norm) || 1 };
  });
  function vectorize(tokens) {
    const tf = new Map();
    for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
    const vector = new Map();
    let norm = 0;
    for (const [token, count] of tf) {
      if (!df.has(token)) continue;
      const weight = (1 + Math.log(count)) * idf(token);
      vector.set(token, weight);
      norm += weight * weight;
    }
    return { vector, norm: Math.sqrt(norm) || 1 };
  }
  return {
    similarities(queryTokens) {
      const query = vectorize(queryTokens);
      return vectors.map(({ vector, norm }) => {
        let dot = 0;
        const shared = [];
        for (const [token, weight] of query.vector) {
          const other = vector.get(token);
          if (other) {
            dot += weight * other;
            if (!token.startsWith('conceito_')) shared.push(token);
          }
        }
        return { score: query.vector.size ? dot / (norm * query.norm) : 0, shared };
      });
    },
  };
}
