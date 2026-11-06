/**
 * Markdown → HTML para as respostas do Copilot. A saída da LLM é tratada como não
 * confiável: todo o texto é escapado ANTES da formatação e só links http(s) viram <a>.
 * Suporta: parágrafos, quebras de linha, **negrito**, *itálico*, `código`, blocos ```,
 * títulos (###), listas numeradas e com marcador, citações (>) e links.
 */
const escapeHtml = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function inline(text) {
  const codes = [];
  let out = text.replace(/`([^`\n]+)`/g, (_, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, href) => `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>`)
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?])/g, (_, lead, href) => `${lead}<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>`)
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    // Itálico só quando o trecho tem letras (não estraga caminhos como Printers\*.*).
    .replace(/(^|[^*\w\\])\*([^*\s][^*\n]*?)\*(?!\*)/g, (all, lead, body) => (/[A-Za-zÀ-ÿ]/.test(body) ? `${lead}<em>${body}</em>` : all))
    .replace(/(^|[^_\w])_([^_\s][^_\n]*?)_(?!\w)/g, (all, lead, body) => (/[A-Za-zÀ-ÿ]/.test(body) ? `${lead}<em>${body}</em>` : all));
  return out.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

/** Uma linha de Markdown (negrito, itálico, código, links), já escapada. */
export function renderInline(source = '') {
  return inline(escapeHtml(source));
}

export function renderMarkdown(source = '') {
  const lines = escapeHtml(String(source).replace(/\r\n?/g, '\n')).split('\n');
  const html = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```\s*([\w-]*)\s*$/);
    if (fence) {
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) code.push(lines[i++]);
      i++;
      html.push(`<pre class="md-code"><code>${code.join('\n')}</code></pre>`);
      continue;
    }
    const heading = line.match(/^\s*(#{1,4})\s+(.+)$/);
    if (heading) {
      html.push(`<h4 class="md-h">${inline(heading[2])}</h4>`);
      i++;
      continue;
    }
    if (/^\s*(?:&gt;)\s?/.test(line)) {
      const quote = [];
      while (i < lines.length && /^\s*(?:&gt;)\s?/.test(lines[i])) quote.push(lines[i++].replace(/^\s*&gt;\s?/, ''));
      html.push(`<blockquote>${quote.map(inline).join('<br>')}</blockquote>`);
      continue;
    }
    const ordered = /^\s*\d+[.)]\s+/;
    const bullet = /^\s*[-*•]\s+/;
    if (ordered.test(line) || bullet.test(line)) {
      const isOrdered = ordered.test(line);
      const pattern = isOrdered ? ordered : bullet;
      const items = [];
      while (i < lines.length && (pattern.test(lines[i]) || (/^\s{2,}\S/.test(lines[i]) && items.length))) {
        if (pattern.test(lines[i])) items.push(lines[i].replace(pattern, ''));
        else items[items.length - 1] += ` ${lines[i].trim()}`;
        i++;
      }
      const tag = isOrdered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.map((item) => `<li>${inline(item)}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const paragraph = [];
    while (i < lines.length && lines[i].trim() && !/^\s*```/.test(lines[i]) && !/^\s*#{1,4}\s/.test(lines[i]) && !ordered.test(lines[i]) && !bullet.test(lines[i]) && !/^\s*&gt;/.test(lines[i])) paragraph.push(lines[i++]);
    html.push(`<p>${paragraph.map(inline).join('<br>')}</p>`);
  }
  return html.join('');
}

export { escapeHtml };
