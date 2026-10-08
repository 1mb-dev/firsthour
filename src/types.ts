export type SourceId = 'hn' | 'yc' | 'boards';

/** What the browser receives. No author, no body. */
export interface Item {
  id: string;
  source: SourceId;
  where: string;
  title: string;
  posted_at: string;
  url: string;
}

/** An item before selection. `body` is for classification only and never leaves the Worker or the boards job. */
export interface Candidate extends Item {
  body: string;
  /** Structured remote flag from an ATS. Undefined means the text gate decides. */
  remote?: boolean;
}

export interface Deps {
  fetch: typeof fetch;
  now: Date;
  userAgent: string;
  /** One deadline for the whole request; fetches abort on it. */
  signal: AbortSignal;
  kv?: Pick<KVNamespace, 'get'>;
}

export interface Loaded {
  posts: Candidate[];
  /** When the data was produced, if not now (the boards snapshot). */
  fetched_at?: string;
  /** Set when the source answered but is degraded (stale snapshot, truncated page). Posts may still be present. */
  error?: string;
  /** Newest Who is hiring thread, for the next-thread estimate. */
  thread_at?: string;
}

export interface Adapter {
  id: SourceId;
  load(deps: Deps): Promise<Loaded>;
}

/** A failure with a short code fit for the status line ("429", "timeout", "schema"). */
export class SourceError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
