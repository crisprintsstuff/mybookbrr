export type MediaType = 'eBook' | 'Audiobook';
export type ReleaseSource = 'irc' | 'wishlist' | 'manual';

export interface Release {
  torrentId: string;
  title: string;
  author: string;
  series: string;
  narrator: string;
  mediaType: MediaType;
  format: string;
  sizeMB: number;
  sizeStr: string;
  freeleech: boolean;
  vip: boolean;
  bitrate: number;
  torrentUrl: string;
  source: ReleaseSource;
  raw: string;
  year?: string;
  category?: string;
}

export interface FilterRule {
  id: string;
  name: string;
  enabled: boolean;
  priority: number;
  matchAllReleases: boolean;
  limitPeriod: 'unlimited' | 'daily' | 'weekly' | 'monthly';
  maxDownloads: number;
  snatchCount: number;
  snatchHistoryTimestamps: number[];
  mediaTypes: string[];
  authors: string[];
  excludeAuthors: string[];
  narrators: string[];
  series: string[];
  formats: string[];
  titlePattern: string;
  minBitrate: number;
  minSizeMB: number;
  maxSizeMB: number;
  freeleechOnly: boolean;
  vipOnly: boolean;
  clientType: 'qbittorrent' | 'watchfolder';
  clientCategory: string;
  savePath: string;
  discordWebhookUrl: string;
}

export interface FilterEvaluation {
  matched: boolean;
  matchedFilter: FilterRule | null;
  reasons: string[];
  evaluationLog: Array<{ filterName: string; failures: string[] }>;
}

export interface WishlistWatch {
  id: string;
  name: string;
  enabled: boolean;
  query: string;
  author: string;
  series: string;
  narrator: string;
  mediaTypes: string[];
  formats: string[];
  intervalMinutes: number;
  lastRunAt: string | null;
  lastResult: string;
}

export interface SnatchRecord {
  id: string;
  torrentId: string;
  title: string;
  author: string;
  series: string;
  mediaType: string;
  format: string;
  source: string;
  filterId: string | null;
  filterName: string | null;
  status: string;
  error: string | null;
  clientMessage: string | null;
  createdAt: string;
}

export interface AppEvent {
  type: string;
  payload: unknown;
  createdAt?: string;
}
