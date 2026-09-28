import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Scale } from 'lucide-react';

import { PageLoader, ErrorState } from '@/components/ui';
import { legalApi } from '@/lib/api/legal';

/**
 * Minimal markdown → JSX renderer covering exactly the subset used in the
 * seeded legal pages (migration 0035): headers, bold, links, tables, lists,
 * paragraphs. Not a general-purpose renderer — there's no network access in
 * this environment to install a real markdown library, and pulling in a
 * full parser for four static compliance pages would be overkill anyway.
 */
function renderMarkdown(md: string) {
  const lines = md.split('\n');
  const blocks: JSX.Element[] = [];
  let i = 0;
  let key = 0;

  const renderInline = (text: string) => {
    // Bold (**text**) and links ([text](url)), in one pass, left to right.
    const parts: (string | JSX.Element)[] = [];
    let rest = text;
    const pattern = /(\*\*(.+?)\*\*)|(\[(.+?)\]\((.+?)\))/;
    while (rest.length > 0) {
      const m = pattern.exec(rest);
      if (!m) { parts.push(rest); break; }
      if (m.index > 0) parts.push(rest.slice(0, m.index));
      if (m[1]) parts.push(<b key={key++} className="text-text">{m[2]}</b>);
      else if (m[3]) parts.push(m[5].startsWith('/') ? <Link key={key++} to={m[5]} className="text-primary">{m[4]}</Link> : <a key={key++} href={m[5]} className="text-primary" target="_blank" rel="noreferrer">{m[4]}</a>);
      rest = rest.slice(m.index + m[0].length);
    }
    return parts;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('# ')) { blocks.push(<h1 key={key++} className="mb-3 mt-6 font-display text-2xl text-text">{renderInline(line.slice(2))}</h1>); i++; continue; }
    if (line.startsWith('## ')) { blocks.push(<h2 key={key++} className="mb-2 mt-6 text-lg font-semibold text-text">{renderInline(line.slice(3))}</h2>); i++; continue; }
    if (line.startsWith('| ')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        if (!lines[i].includes('---')) rows.push(lines[i].split('|').map((c) => c.trim()).filter((c) => c.length > 0));
        i++;
      }
      const [header, ...body] = rows;
      blocks.push(
        <table key={key++} className="mb-4 w-full border-collapse text-sm">
          <thead><tr>{header.map((h, c) => <th key={c} className="border-b border-border px-3 py-2 text-left font-semibold text-text">{h}</th>)}</tr></thead>
          <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci} className="border-b border-border px-3 py-2 text-text-muted">{renderInline(c)}</td>)}</tr>)}</tbody>
        </table>,
      );
      continue;
    }
    if (line.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) { items.push(lines[i].slice(2)); i++; }
      blocks.push(<ul key={key++} className="mb-4 ml-5 list-disc text-text-muted">{items.map((it, idx) => <li key={idx} className="mb-1">{renderInline(it)}</li>)}</ul>);
      continue;
    }
    if (line.trim().length === 0) { i++; continue; }
    // Paragraph — consume until a blank line or the next block-starter.
    const para: string[] = [];
    while (i < lines.length && lines[i].trim().length > 0 && !lines[i].startsWith('#') && !lines[i].startsWith('| ') && !lines[i].startsWith('- ')) {
      para.push(lines[i]); i++;
    }
    blocks.push(<p key={key++} className="mb-4 leading-relaxed text-text-muted">{renderInline(para.join(' '))}</p>);
  }
  return blocks;
}

export function LegalPage() {
  const { slug = 'terms' } = useParams();
  const page = useQuery({ queryKey: ['legal-page', slug], queryFn: () => legalApi.page(slug) });

  return (
    <div className="mx-auto max-w-3xl px-4 py-10">
      {page.isLoading ? <PageLoader /> : page.isError ? <ErrorState error={page.error} onRetry={page.refetch} /> : page.data && (
        <>
          <div className="mb-2 flex items-center gap-2 text-text-muted"><Scale className="h-4 w-4" /> <span className="text-xs">Legal · Ticketly</span></div>
          <article>{renderMarkdown(page.data.body)}</article>
        </>
      )}
    </div>
  );
}
