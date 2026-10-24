import type { PageTabMeta, PageTabsStatusMatrix } from '@/types/page';

function getPageFromTabs(pageTabs: PageTabMeta[], pageId: string) {
  return pageTabs.find(tab => tab.id === pageId);
}

export function assertPageAvailability(pageTabs: PageTabMeta[], pageId: string) {
  const currentPage = getPageFromTabs(pageTabs, pageId);

  if (currentPage && currentPage.health === 'unavailable') {
    const reason = currentPage.failureType ?? 'unknown';
    const statusCode = currentPage.failureStatusCode ?? 0;
    const statusMessage = currentPage.failureStatusMessage ?? 'Unknown';
    const failureMessage = currentPage.failureMessage ?? 'Unknown error';
    throw new Error(
      `CURRENT_PAGE_UNAVAILABLE::${pageId}::${reason}::${statusCode}::${statusMessage}::${failureMessage}`
    );
  }
}

export function assertGlobalAvailability(
  matrix: PageTabsStatusMatrix,
  pageTabs: PageTabMeta[],
  totalPages: number,
  strictMode: boolean
) {
  if (strictMode && totalPages > 1 && matrix.status === 'all_failed') {
    const firstFailedPage = pageTabs.find(tab => tab.health === 'unavailable');
    const statusCode = firstFailedPage?.failureStatusCode ?? 0;
    const statusMessage = firstFailedPage?.failureStatusMessage ?? 'Unknown';
    const failureMessage = firstFailedPage?.failureMessage ?? 'All pages unavailable';
    throw new Error(`ALL_PAGES_UNAVAILABLE::${statusCode}::${statusMessage}::${failureMessage}`);
  }
}
