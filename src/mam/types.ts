export interface MamSearchParams {
  text?: string;
  author?: string;
  title?: string;
  series?: string;
  narrator?: string;
  /** 13 = Audiobooks, 14 = E-Books */
  mainCat?: number | number[];
  startNumber?: number;
  perPage?: number;
  sortType?: string;
  searchIn?: string;
}

export interface MamSearchHit {
  id: number | string;
  title: string;
  author_info?: string | Record<string, string>;
  author?: string;
  narrator_info?: string | Record<string, string>;
  narrator?: string;
  series_info?: string | Record<string, unknown>;
  series?: string;
  category?: string | number;
  catname?: string;
  filetype?: string;
  size?: string | number;
  freefile?: string | number | boolean;
  vip?: string | number | boolean;
  bitrate?: string;
  language?: string;
  tags?: string;
  description?: string;
  [key: string]: unknown;
}

export interface MamSearchResult {
  data: MamSearchHit[];
  total?: number;
  found?: number;
  raw: unknown;
}

export interface MamDownloadResult {
  success: true;
  torrentId: string;
  filename: string;
  filePath: string;
  sizeBytes: number;
  buffer: Buffer;
}
