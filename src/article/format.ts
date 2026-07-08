export type ArticleStyle = "clean" | "editorial" | "minimal";

export type RenderArticleInput = {
  title: string;
  markdown?: string;
  html?: string;
  style?: ArticleStyle;
  includeTitleInContent?: boolean;
};

const stylePresets: Record<ArticleStyle, { accent: string; text: string; muted: string }> = {
  clean: {
    accent: "#1f6feb",
    text: "#1f2937",
    muted: "#6b7280",
  },
  editorial: {
    accent: "#0f766e",
    text: "#1f2933",
    muted: "#667085",
  },
  minimal: {
    accent: "#111827",
    text: "#222222",
    muted: "#777777",
  },
};

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function inlineMarkdown(value: string) {
  let html = escapeHtml(value);
  html = html.replace(
    /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g,
    '<img src="$2" alt="$1" style="max-width:100%;height:auto;border-radius:6px;" />',
  );
  html = html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
    '<a href="$2" style="color:#1f6feb;text-decoration:none;">$1</a>',
  );
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  html = html.replace(
    /`([^`]+)`/g,
    '<code style="font-family:Consolas,monospace;background:#f2f4f7;padding:2px 4px;border-radius:4px;">$1</code>',
  );
  return html;
}

function sanitizeWechatHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/javascript:/gi, "");
}

function collectWarnings(html: string) {
  const warnings: string[] = [];
  if (/<script/i.test(html)) {
    warnings.push("Script tags were stripped.");
  }
  if (/src=["']https?:\/\//i.test(html) && !/mmbiz\.qpic\.cn/i.test(html)) {
    warnings.push(
      "Content contains external image URLs. Upload inline images to WeChat first for reliable drafts.",
    );
  }
  return warnings;
}

export function renderWechatArticle(input: RenderArticleInput) {
  const style = input.style ?? "clean";
  const preset = stylePresets[style];
  const rawBody = input.html ?? renderMarkdown(input.markdown ?? "", style);
  const warnings = collectWarnings(rawBody);
  const body = sanitizeWechatHtml(rawBody);
  const title = input.includeTitleInContent
    ? `<h1 style="margin:0 0 20px;color:${preset.text};font-size:24px;line-height:1.35;font-weight:800;">${escapeHtml(
        input.title,
      )}</h1>`
    : "";
  const html = [
    `<section style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:${preset.text};font-size:16px;line-height:1.8;">`,
    title,
    body,
    "</section>",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    html,
    warnings,
    characterCount: html.length,
  };
}

function renderMarkdown(markdown: string, style: ArticleStyle) {
  const preset = stylePresets[style];
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let quote: string[] = [];
  let code: string[] | undefined;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push(
      `<p style="margin:0 0 18px;line-height:1.85;color:${preset.text};font-size:16px;">${inlineMarkdown(
        paragraph.join(" "),
      )}</p>`,
    );
    paragraph = [];
  };

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      `<ul style="margin:0 0 18px;padding-left:1.2em;color:${preset.text};font-size:16px;line-height:1.8;">${list
        .map((item) => `<li style="margin:4px 0;">${inlineMarkdown(item)}</li>`)
        .join("")}</ul>`,
    );
    list = [];
  };

  const flushQuote = () => {
    if (quote.length === 0) return;
    blocks.push(
      `<blockquote style="margin:0 0 18px;padding:10px 14px;border-left:4px solid ${preset.accent};background:#f6f8fb;color:${preset.muted};line-height:1.8;">${quote
        .map(inlineMarkdown)
        .join("<br />")}</blockquote>`,
    );
    quote = [];
  };

  const flushFlow = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.startsWith("```")) {
      if (code) {
        blocks.push(
          `<pre style="margin:0 0 18px;padding:14px;overflow:auto;background:#111827;color:#f9fafb;border-radius:6px;font-size:13px;line-height:1.6;"><code>${escapeHtml(
            code.join("\n"),
          )}</code></pre>`,
        );
        code = undefined;
      } else {
        flushFlow();
        code = [];
      }
      continue;
    }
    if (code) {
      code.push(rawLine);
      continue;
    }
    if (!line.trim()) {
      flushFlow();
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushFlow();
      const level = heading[1].length;
      const size = level === 1 ? 22 : level === 2 ? 19 : 17;
      const tag = `h${Math.min(level + 1, 4)}`;
      blocks.push(
        `<${tag} style="margin:24px 0 12px;color:${preset.text};font-size:${size}px;line-height:1.4;font-weight:700;">${inlineMarkdown(
          heading[2],
        )}</${tag}>`,
      );
      continue;
    }
    const unordered = /^[-*]\s+(.+)$/.exec(line);
    const ordered = /^\d+\.\s+(.+)$/.exec(line);
    if (unordered || ordered) {
      flushParagraph();
      flushQuote();
      list.push((unordered ?? ordered)?.[1] ?? "");
      continue;
    }
    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      quote.push(line.replace(/^>\s?/, ""));
      continue;
    }
    paragraph.push(line.trim());
  }

  flushFlow();
  return blocks.join("\n");
}
