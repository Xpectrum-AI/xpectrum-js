/**
 * A small Markdown renderer for assistant replies.
 *
 * Hand-written rather than pulled from a library so the SDK keeps its single
 * runtime dependency and stays small — a chat bubble needs a fraction of what a
 * general Markdown parser does.
 *
 * Safety: the input is escaped **before** any markup is produced, so nothing the
 * model emits can become a live tag. Every tag in the output is one this file
 * wrote, and every URL is checked against an allowlist of schemes — a reply
 * containing `<img onerror=…>` or `[click](javascript:…)` renders as text.
 */

/** Schemes safe to put in an href. */
const LINK_SCHEME = /^(https?:\/\/|mailto:)/i;
/** Images may also come inline as base64. */
const IMAGE_SCHEME = /^(https?:\/\/|data:image\/)/i;

/** Placeholder for extracted code. Distinctive enough not to occur in prose. */
const TOKEN = (i: number) => `%%XPB${i}%%`;
const TOKEN_RE = /%%XPB(\d+)%%/g;
const TOKEN_ONLY_RE = /^%%XPB(\d+)%%$/;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function safeUrl(url: string, pattern: RegExp): string | null {
  // `&` is already `&amp;` from escaping, which is what an attribute wants
  const trimmed = url.trim().replace(/&amp;/g, '&');
  return pattern.test(trimmed) ? trimmed.replace(/&/g, '&amp;').replace(/"/g, '%22') : null;
}

/** Inline rules — applied to text that is already escaped and code-free. */
function inline(text: string): string {
  return (
    text
      // Images first: ![alt](url) — otherwise the link rule would claim them
      .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, alt, url) => {
        const href = safeUrl(url, IMAGE_SCHEME);
        return href ? `<img class="xp-md-img" src="${href}" alt="${alt}" loading="lazy" />` : whole;
      })
      // [text](url)
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, label, url) => {
        const href = safeUrl(url, LINK_SCHEME);
        return href ? `<a href="${href}" target="_blank" rel="noopener noreferrer">${label}</a>` : whole;
      })
      // Bare URLs — the lead character keeps this off ones already in an href
      .replace(/(^|[\s(])(https?:\/\/[^\s<>()]+)/g, (_m, lead: string, url: string) => {
        const href = safeUrl(url, LINK_SCHEME);
        return href ? `${lead}<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>` : `${lead}${url}`;
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      // Single * / _ for italics, avoiding the middle of words like snake_case
      .replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1<em>$2</em>')
      .replace(/(^|[^_\w])_([^_\n]+)_(?![_\w])/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>')
  );
}

/**
 * Render Markdown to HTML safe to assign to innerHTML.
 *
 * Supports headings, bold, italic, strikethrough, links, images, inline and
 * fenced code, blockquotes, bullet and numbered lists, and horizontal rules.
 */
export function renderMarkdown(source: string): string {
  if (!source) return '';

  let text = escapeHtml(source);

  // Pull code out before anything else, so markup inside it stays literal
  const blocks: string[] = [];
  const blockLevel = new Set<number>();

  text = text.replace(/```(\w+)?\n?([\s\S]*?)```/g, (_m, lang: string | undefined, code: string) => {
    blocks.push(`<pre class="xp-md-pre"><code data-lang="${lang || ''}">${code.replace(/\n$/, '')}</code></pre>`);
    blockLevel.add(blocks.length - 1);
    // Surrounded by newlines so the block rules below see it standing alone
    return `\n${TOKEN(blocks.length - 1)}\n`;
  });

  text = text.replace(/`([^`\n]+)`/g, (_m, code: string) => {
    blocks.push(`<code class="xp-md-code">${code}</code>`);
    return TOKEN(blocks.length - 1);
  });

  const html: string[] = [];
  let list: 'ul' | 'ol' | null = null;

  const closeList = () => {
    if (list) {
      html.push(`</${list}>`);
      list = null;
    }
  };
  const openList = (kind: 'ul' | 'ol') => {
    if (list !== kind) {
      closeList();
      html.push(`<${kind} class="xp-md-list">`);
      list = kind;
    }
  };

  for (const raw of text.split('\n')) {
    const line = raw.trimEnd();
    const trimmed = line.trim();

    if (!trimmed) {
      closeList();
      continue;
    }

    // A fenced block is already complete markup — a <pre> inside a <p> is invalid
    const alone = trimmed.match(TOKEN_ONLY_RE);
    if (alone && blockLevel.has(Number(alone[1]))) {
      closeList();
      html.push(trimmed);
      continue;
    }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeList();
      // # becomes h3, so a heading never dwarfs the surrounding UI
      const level = Math.min(heading[1].length + 2, 6);
      html.push(`<h${level} class="xp-md-h">${inline(heading[2])}</h${level}>`);
      continue;
    }

    if (/^(---+|\*\*\*+)$/.test(trimmed)) {
      closeList();
      html.push('<hr class="xp-md-hr" />');
      continue;
    }

    // `>` has already become `&gt;` — escaping runs before parsing
    const quote = line.match(/^&gt;\s?(.*)$/);
    if (quote) {
      closeList();
      html.push(`<blockquote class="xp-md-quote">${inline(quote[1])}</blockquote>`);
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      openList('ul');
      html.push(`<li>${inline(bullet[1])}</li>`);
      continue;
    }

    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (numbered) {
      openList('ol');
      html.push(`<li>${inline(numbered[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p class="xp-md-p">${inline(line)}</p>`);
  }
  closeList();

  // Put the code back
  return html.join('').replace(TOKEN_RE, (_m, i: string) => blocks[Number(i)] ?? '');
}
