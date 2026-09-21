export interface LootBarLoginResponse {
  status: string;
  msg?: string;
  data?: {
    token: string;
    callback_key: string;
    expire_at: number;
  };
}

export interface LootBarGame {
  game_id: string;
  name: string;
  game_name?: string;
  [key: string]: any;
}

export interface LootBarSku {
  sku_id: string;
  name: string;
  game_name?: string;
  price?: number | string;
  available?: boolean;
  [key: string]: any;
}

export interface LootBarGamesResponse {
  status?: string;
  msg?: string;
  data?: {
    items: LootBarGame[];
    total_page?: number;
    current_page?: number;
  };
}

export interface LootBarSkusResponse {
  status?: string;
  msg?: string;
  data?: {
    items: LootBarSku[];
  };
}

export interface LootBarOrderResponse {
  status?: string;
  msg?: string;
  message?: string;
  error?: string;
  data?: {
    order_id?: string;
    reference_id?: string;
    state?: number; // Lootbar uses 'state' 0, 1, 2, 3
    [key: string]: any;
  };
}

export interface LootBarAssetResponse {
  status?: string;
  msg?: string;
  data?: {
    total_amount?: number;
    available_amount?: number;
    currency?: string;
    [key: string]: any;
  };
}
