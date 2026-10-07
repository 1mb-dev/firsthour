import type { Adapter } from '../types.ts';
import { boards } from './boards.ts';
import { hn } from './hn.ts';
import { yc } from './yc.ts';

/** Registry order is source order, which breaks ties between posts with the same timestamp. */
export const ADAPTERS: readonly Adapter[] = [hn, yc, boards];
