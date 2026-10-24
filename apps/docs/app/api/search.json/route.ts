import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/source';

// One search database for both languages; Unicode word segmentation covers Chinese without a separate tokenizer.
export const dynamic = 'force-static';
export const { staticGET: GET } = createFromSource(source);
