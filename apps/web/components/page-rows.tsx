import type { PageEntry } from '@codedna/shared';
import { pageStatus } from '@/lib/tiers';

/** Rows of pages, each a real button. Route-handler groups are listed last. */
export function PageRows({ pages, onPage }: { pages: PageEntry[]; onPage: (pageId: string) => void }) {
  if (!pages.length) return <p className="flow-note flow-pad">No pages or route handlers were detected.</p>;
  return (
    <ul className="flow-rows">
      {pages.map((page) => {
        const status = pageStatus(page.tierSummary, page.actionCount);
        return (
          <li key={page.id}>
            <button type="button" className="flow-page-row" onClick={() => onPage(page.id)} aria-label={`${page.route}: ${page.actionCount} action${page.actionCount === 1 ? '' : 's'}, ${status.text}`}>
              <span className="flow-mono flow-page-row__route">{page.route}</span>
              <span className="flow-page-row__desc">{page.kind === 'api' ? 'Route handlers no page renders' : page.title ?? page.file}</span>
              <span>{page.actionCount} action{page.actionCount === 1 ? '' : 's'}</span>
              <span className={`flow-status${status.tier ? ` flow-status--${status.tier}` : ''}`}>{status.text}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
