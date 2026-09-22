import { Context } from 'telegraf';
import { BulkOrderItem } from '../bulkOrderService';
import { LootBarClient } from '../providers/lootbar/LootBarClient';
import { TopupNationService } from '../providers/topupnation/TopupNationService';
import { G2BulkService } from '../providers/g2bulk/G2BulkService';

export interface SessionData {
  provider?: 'lootbar' | 'topupnation' | 'g2bulk';
  step?: string;
  gameId?: string;
  gameName?: string;
  skus?: any[];
  skuId?: string;
  skuName?: string;
  skuPrice?: number;
  quantity?: number;
  playerName?: string;
  requiredFields?: any[];
  currentFieldIndex?: number;
  extraInfo?: Record<string, string>;
  topupAmount?: number;
  topupNote?: string;
  topupPhotoFileId?: string;
  bulkOrders?: BulkOrderItem[];
  bulkTotalPrice?: number;
  bulkRawText?: string;
  orderInProgress?: boolean;
  orderIdempotencyKey?: string;
}

export interface MyContext extends Context {
  session: SessionData;
}

export interface BotServices {
  lootbar: LootBarClient;
  topupNation?: TopupNationService;
  g2bulk?: G2BulkService;
  adminChatId?: string;
}
