with open('server/providers/lootbar/LootBarClient.ts', 'r', encoding='utf-8') as f:
    code = f.read()

# Fix imports
code = code.replace("import { LootBarGame, LootBarSku } from './types';", 
"import { LootBarGame, LootBarSku, LootBarGamesResponse, LootBarSkusResponse, LootBarOrderResponse, LootBarAssetResponse } from './types';")

# Fix method return types
code = code.replace("async getGames(pageNum: number = 1, pageSize: number = 100): Promise<any>", "async getGames(pageNum: number = 1, pageSize: number = 100): Promise<LootBarGamesResponse>")
code = code.replace("async getSkus(gameId: string): Promise<any>", "async getSkus(gameId: string): Promise<LootBarSkusResponse>")
code = code.replace("async createOrder(referenceId: string, gameId: string, skuId: string, quantity: number, extraInfo: Record<string, string>): Promise<any>", "async createOrder(referenceId: string, gameId: string, skuId: string, quantity: number, extraInfo: Record<string, string>): Promise<LootBarOrderResponse>")
code = code.replace("async queryOrder(referenceId: string): Promise<any>", "async queryOrder(referenceId: string): Promise<LootBarOrderResponse>")
code = code.replace("async queryAsset(): Promise<any>", "async queryAsset(): Promise<LootBarAssetResponse>")

with open('server/providers/lootbar/LootBarClient.ts', 'w', encoding='utf-8') as f:
    f.write(code)
