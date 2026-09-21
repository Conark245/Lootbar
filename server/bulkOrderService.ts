import { v4 as uuidv4 } from 'uuid';
import { LootBarClient } from './providers/lootbar/LootBarClient';
import { TopupNationService } from './providers/topupnation/TopupNationService';
import { FzrCardsService } from './providers/fzrcards/FzrCardsService';
import { G2BulkService } from './providers/g2bulk/G2BulkService';
import { TopupNationProduct } from './models/TopupNationProduct';
import { FzrCardsProduct } from './models/FzrCardsProduct';
import { SavedGame } from './models/SavedGame';
import { Order } from './models/Order';
import { User, IUser } from './models/User';
import { BulkOrderBatch, IBulkOrderBatch } from './models/BulkOrderBatch';
import { parseSkuWithQuantity } from './bot/matching';
import { parseCommandArgs } from './bot/helpers';

export interface BulkOrderItem {
  lineIndex: number;
  rawLine: string;
  provider: 'lootbar' | 'topupnation' | 'fzrcards' | 'g2bulk';
  gameId: string;
  gameName: string;
  skuId: string;
  skuName: string;
  unitPrice: number;
  quantity: number;
  totalPrice: number;
  extraInfo: Record<string, string>;
  playerName?: string;
}

export interface BulkLineError {
  lineIndex: number;
  rawLine: string;
  error: string;
}

export interface BulkParseResult {
  valid: boolean;
  totalLines: number;
  validItems: BulkOrderItem[];
  errors: BulkLineError[];
  totalPrice: number;
  totalQuantity: number;
}

export interface BulkExecuteItemResult {
  lineIndex: number;
  rawLine: string;
  provider: 'lootbar' | 'topupnation' | 'fzrcards' | 'g2bulk';
  gameName: string;
  skuName: string;
  quantity: number;
  price: number;
  playerName?: string;
  success: boolean;
  referenceId?: string;
  orderId?: string;
  statusText?: string;
  error?: string;
}

export interface BulkExecuteSummary {
  batchId: string;
  totalRequested: number;
  successCount: number;
  failedCount: number;
  totalSpent: number;
  userBalanceBefore: number;
  userBalanceAfter: number;
  isApiLinked: boolean;
  results: BulkExecuteItemResult[];
  createdAt?: Date;
}

function getGameDefaultShortKey(name: string, gameId: string): string {
  const n = (name || '').toLowerCase();
  if (n.includes('mobile legends') || n.includes('mlbb')) return 'ml';
  if (n.includes('pubg')) return 'pubg';
  if (n.includes('free fire') || n.includes('freefire')) return 'ff';
  if (n.includes('genshin')) return 'gi';
  if (n.includes('honkai: star rail') || n.includes('star rail') || n.includes('hsr')) return 'hsr';
  if (n.includes('arena of valor') || n.includes('aov')) return 'aov';
  if (n.includes('honor of kings') || n.includes('hok')) return 'hok';
  if (n.includes('call of duty') || n.includes('codm')) return 'codm';
  if (n.includes('clash of clans') || n.includes('coc')) return 'coc';
  if (n.includes('brawl stars')) return 'bs';
  if (n.includes('roblox')) return 'rbx';
  if (n.includes('valorant')) return 'val';
  if (n.includes('blood strike') || n.includes('bloodstrike')) return 'blood';
  if (n.includes('zenless zone zero') || n.includes('zzz')) return 'zzz';
  if (n.includes('identity v') || n.includes('idv')) return 'idv';
  if (n.includes('farlight')) return 'farlight';
  if (n.includes('undawn')) return 'undawn';
  if (n.includes('lifeafter')) return 'lifeafter';
  return `g${gameId.slice(0, 4)}`;
}

/**
 * Service to parse and execute Bulk Top-Up orders uniformly across Bot & Web Dashboard
 */
export class BulkOrderService {
  /**
   * Parse multi-line bulk order text into validated BulkOrderItems
   */
  public static async parseBulkText(
    rawText: string,
    lootbarClient: LootBarClient
  ): Promise<BulkParseResult> {
    const rawLines = rawText
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith('#') && !l.startsWith('//'));

    const validItems: BulkOrderItem[] = [];
    const errors: BulkLineError[] = [];

    if (rawLines.length === 0) {
      return {
        valid: false,
        totalLines: 0,
        validItems: [],
        errors: [{ lineIndex: 1, rawLine: '', error: 'No order lines provided' }],
        totalPrice: 0,
        totalQuantity: 0
      };
    }

    // Cache database & SKU lookups for speed
    const savedGames = await SavedGame.find({ isEnabled: { $ne: false } });
    const tpnProducts = await TopupNationProduct.find({ isEnabled: { $ne: false } });
    const fzrProducts = await FzrCardsProduct.find({ isEnabled: { $ne: false } });
    const skuCache: Record<string, any[]> = {};

    for (let i = 0; i < rawLines.length; i++) {
      const lineIndex = i + 1;
      let line = rawLines[i];

      // Ignore if line is just a command label like "/bulk" or "bulk"
      if (line.toLowerCase() === '/bulk' || line.toLowerCase() === 'bulk') {
        continue;
      }

      // Strip leading numbering e.g. "1.", "1)", "1:", "#1", "-", "•"
      line = line.replace(/^\d+[\.\)\-:]\s*/, '').replace(/^[-*•]\s*/, '').trim();

      // Strip leading dot or slash
      if (line.startsWith('.') || line.startsWith('/')) {
        line = line.slice(1).trim();
      }

      if (!line) continue;

      const tokens = parseCommandArgs(line);
      if (tokens.length < 2) {
        errors.push({
          lineIndex,
          rawLine: rawLines[i],
          error: 'Format incomplete. Example: .ml 12345678 2001 wp'
        });
        continue;
      }

      const inputKey = tokens[0].toLowerCase();
      const rawArgs = tokens.slice(1);

      // Check LootBar Games
      const matchedGame = savedGames.find((g: any) => {
        const k = (g.shortKey || getGameDefaultShortKey(g.name, g.gameId)).toLowerCase();
        return k === inputKey || String(g.gameId).toLowerCase() === inputKey;
      });

      if (matchedGame) {
        const gameId = String(matchedGame.gameId);
        const gameName = matchedGame.name || 'Game';

        try {
          if (!skuCache[gameId]) {
            const resp = await lootbarClient.getSkus(gameId);
            skuCache[gameId] = resp?.data?.items || [];
          }
          const skus = skuCache[gameId] || [];
          if (skus.length === 0) {
            errors.push({
              lineIndex,
              rawLine: rawLines[i],
              error: `No packages available for ${gameName}`
            });
            continue;
          }

          const requiredFields = (skus[0]?.extra_info || []).filter((f: any) => f.required);
          const minFields = requiredFields.length > 0 ? requiredFields.length : 1;

          if (rawArgs.length < minFields + 1) {
            errors.push({
              lineIndex,
              rawLine: rawLines[i],
              error: `Missing parameters. Need ${minFields} account field(s) + Package name/key.`
            });
            continue;
          }

          const extraInfo: Record<string, string> = {};
          if (requiredFields.length === 0) {
            extraInfo['uid'] = rawArgs[0];
          } else {
            for (let f = 0; f < requiredFields.length; f++) {
              const field = requiredFields[f];
              extraInfo[field.name] = rawArgs[f];
            }
          }

          const rawProductQuery = rawArgs.slice(minFields).join(' ').trim();
          let skuKeys: Record<string, string> = {};
          if (matchedGame.skuShortKeys) {
            if (matchedGame.skuShortKeys instanceof Map || typeof (matchedGame.skuShortKeys as any).entries === 'function') {
              skuKeys = Object.fromEntries((matchedGame.skuShortKeys as any).entries());
            } else if (typeof matchedGame.skuShortKeys === 'object') {
              skuKeys = { ...matchedGame.skuShortKeys };
            }
          }

          const parsedResult = parseSkuWithQuantity(skus, rawProductQuery, skuKeys, false);
          const matchedSku = parsedResult.sku;
          const quantity = Math.max(1, Math.min(100, parsedResult.quantity || 1));

          if (!matchedSku) {
            errors.push({
              lineIndex,
              rawLine: rawLines[i],
              error: `Package "${rawProductQuery}" not found for ${gameName}`
            });
            continue;
          }

          const unitPrice = parseFloat(matchedSku.reseller_price || matchedSku.price || '0');
          const totalPrice = unitPrice * quantity;

          validItems.push({
            lineIndex,
            rawLine: rawLines[i],
            provider: 'lootbar',
            gameId,
            gameName,
            skuId: String(matchedSku.sku_id),
            skuName: matchedSku.sku_name || `${gameName} Package`,
            unitPrice,
            quantity,
            totalPrice,
            extraInfo
          });
          continue;
        } catch (err: any) {
          errors.push({
            lineIndex,
            rawLine: rawLines[i],
            error: `Failed to resolve ${gameName}: ${err.message}`
          });
          continue;
        }
      }

      // Check TopupNation Products
      const matchedTpn = tpnProducts.find((p: any) => {
        const k = (p.shortKey || '').toLowerCase();
        return k === inputKey || String(p.productId).toLowerCase() === inputKey;
      });

      if (matchedTpn) {
        const productId = String(matchedTpn.productId);
        const productName = matchedTpn.name || 'Game';
        const skus = (matchedTpn.skus || []).filter((s: any) => s.available !== false && s.availability !== false);

        if (skus.length === 0) {
          errors.push({
            lineIndex,
            rawLine: rawLines[i],
            error: `No packages available for ${productName} (TopupNation)`
          });
          continue;
        }

        const requiredFields = (matchedTpn.fields || []).filter((f: any) => f.required);
        const minFields = requiredFields.length > 0 ? requiredFields.length : 1;

        if (rawArgs.length < minFields + 1) {
          errors.push({
            lineIndex,
            rawLine: rawLines[i],
            error: `Missing parameters for ${productName}. Need ${minFields} account field(s) + Package.`
          });
          continue;
        }

        const extraInfo: Record<string, string> = {};
        if (requiredFields.length === 0) {
          extraInfo['userAccount'] = rawArgs[0];
        } else {
          for (let f = 0; f < requiredFields.length; f++) {
            const field = requiredFields[f];
            const keyName = field.name || field.title || `field_${f + 1}`;
            extraInfo[keyName] = rawArgs[f];
          }
        }

        const rawProductQuery = rawArgs.slice(minFields).join(' ').trim();
        let skuKeys: Record<string, string> = {};
        if (matchedTpn.skuShortKeys) {
          if (matchedTpn.skuShortKeys instanceof Map || typeof (matchedTpn.skuShortKeys as any).entries === 'function') {
            skuKeys = Object.fromEntries((matchedTpn.skuShortKeys as any).entries());
          } else if (typeof matchedTpn.skuShortKeys === 'object') {
            skuKeys = { ...matchedTpn.skuShortKeys };
          }
        }

        const parsedResult = parseSkuWithQuantity(skus, rawProductQuery, skuKeys, true);
        const matchedSku = parsedResult.sku;
        const quantity = Math.max(1, Math.min(100, parsedResult.quantity || 1));

        if (!matchedSku) {
          errors.push({
            lineIndex,
            rawLine: rawLines[i],
            error: `Package "${rawProductQuery}" not found for ${productName}`
          });
          continue;
        }

        const unitPrice = typeof matchedSku.price === 'number' ? matchedSku.price : parseFloat(String(matchedSku.price || '0'));
        const totalPrice = unitPrice * quantity;

        validItems.push({
          lineIndex,
          rawLine: rawLines[i],
          provider: 'topupnation',
          gameId: productId,
          gameName: productName,
          skuId: String(matchedSku.sku),
          skuName: matchedSku.name || `${productName} Package`,
          unitPrice,
          quantity,
          totalPrice,
          extraInfo
        });
        continue;
      }

      // Check FZR Cards Products
      const matchedFzr = fzrProducts.find((p: any) => {
        const k = (p.shortKey || '').toLowerCase();
        return k === inputKey || String(p.productId).toLowerCase() === inputKey;
      });

      if (matchedFzr) {
        const productId = String(matchedFzr.productId);
        const productName = matchedFzr.name || 'Game';
        const skus = (matchedFzr.skus || []).filter((s: any) => s.available !== false && s.availability !== false);

        if (skus.length === 0) {
          errors.push({
            lineIndex,
            rawLine: rawLines[i],
            error: `No packages available for ${productName} (FZR Cards)`
          });
          continue;
        }

        const requiredFields = (matchedFzr.fields || []).filter((f: any) => f.required);
        const minFields = requiredFields.length > 0 ? requiredFields.length : 1;

        if (rawArgs.length < minFields + 1) {
          errors.push({
            lineIndex,
            rawLine: rawLines[i],
            error: `Missing parameters for ${productName} (FZR). Need ${minFields} account field(s) + Package.`
          });
          continue;
        }

        const extraInfo: Record<string, string> = {};
        if (requiredFields.length === 0) {
          extraInfo['player_id'] = rawArgs[0];
        } else {
          for (let f = 0; f < requiredFields.length; f++) {
            const field = requiredFields[f];
            const keyName = field.name || field.title || `field_${f + 1}`;
            extraInfo[keyName] = rawArgs[f];
          }
        }

        const rawProductQuery = rawArgs.slice(minFields).join(' ').trim();
        let skuKeys: Record<string, string> = {};
        if (matchedFzr.skuShortKeys) {
          if (matchedFzr.skuShortKeys instanceof Map || typeof (matchedFzr.skuShortKeys as any).entries === 'function') {
            skuKeys = Object.fromEntries((matchedFzr.skuShortKeys as any).entries());
          } else if (typeof matchedFzr.skuShortKeys === 'object') {
            skuKeys = { ...matchedFzr.skuShortKeys };
          }
        }

        const parsedResult = parseSkuWithQuantity(skus, rawProductQuery, skuKeys, true);
        const matchedSku = parsedResult.sku;
        const quantity = Math.max(1, Math.min(100, parsedResult.quantity || 1));

        if (!matchedSku) {
          errors.push({
            lineIndex,
            rawLine: rawLines[i],
            error: `Package "${rawProductQuery}" not found for ${productName} (FZR Cards)`
          });
          continue;
        }

        const unitPrice = typeof matchedSku.price === 'number' ? matchedSku.price : parseFloat(String(matchedSku.price || '0'));
        const totalPrice = unitPrice * quantity;

        validItems.push({
          lineIndex,
          rawLine: rawLines[i],
          provider: 'fzrcards',
          gameId: productId,
          gameName: productName,
          skuId: String(matchedSku.sku),
          skuName: matchedSku.name || `${productName} Package`,
          unitPrice,
          quantity,
          totalPrice,
          extraInfo
        });
        continue;
      }

      // Neither LootBar, TopupNation, nor FZR Cards matched
      errors.push({
        lineIndex,
        rawLine: rawLines[i],
        error: `Unknown game shortKey: "${inputKey}". Send .games or .fzr to see available shortcuts.`
      });
    }

    const totalPrice = validItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const totalQuantity = validItems.reduce((sum, item) => sum + item.quantity, 0);

    return {
      valid: errors.length === 0 && validItems.length > 0,
      totalLines: rawLines.length,
      validItems,
      errors,
      totalPrice,
      totalQuantity
    };
  }

  /**
   * Execute valid bulk items sequentially with balance management
   */
  public static async executeBulkOrders(
    user: IUser,
    items: BulkOrderItem[],
    lootbarClient: LootBarClient,
    topupNationService?: TopupNationService,
    fzrCardsService?: FzrCardsService,
    options?: { rawText?: string; source?: 'bot' | 'web' }
  ): Promise<BulkExecuteSummary> {
    const isApiLinked = !!(user.useDirectApiBalance || user.balanceMode === 'api');
    const balanceBefore = user.balance || 0;
    let currentBalance = balanceBefore;
    let totalSpent = 0;
    let successCount = 0;
    let failedCount = 0;
    const results: BulkExecuteItemResult[] = [];
    const batchId = 'BULK-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    for (const item of items) {
      const orderCost = item.totalPrice;

      // 1. Balance check and atomic deduction for standard wallet users
      if (!isApiLinked) {
        const deductedUser = await User.findOneAndUpdate(
          { _id: user._id, balance: { $gte: orderCost } },
          { $inc: { balance: -orderCost } },
          { returnDocument: 'after' }
        );

        if (!deductedUser) {
          failedCount++;
          results.push({
            lineIndex: item.lineIndex,
            rawLine: item.rawLine,
            provider: item.provider,
            gameName: item.gameName,
            skuName: item.skuName,
            quantity: item.quantity,
            price: orderCost,
            success: false,
            error: `Insufficient balance (Need $${orderCost.toFixed(3)})`
          });
          continue;
        }

        currentBalance = deductedUser.balance;
      }

      const referenceId = uuidv4();

      try {
        if (item.provider === 'fzrcards' && fzrCardsService) {
          // Execute FZR Cards order
          const fzrResult = await fzrCardsService.placeOrder({
            telegramChatId: user.telegramChatId,
            telegramUsername: user.username,
            telegramFirstName: user.firstName,
            productId: item.gameId,
            sku: item.skuId,
            fields: item.extraInfo, skipBalanceDeduction: true,
            quantity: item.quantity
          });

          if (!fzrResult.success || !fzrResult.order) {
            if (!isApiLinked) {
              await User.updateOne({ _id: user._id }, { $inc: { balance: orderCost } });
              currentBalance += orderCost;
            }
            failedCount++;
            results.push({
              lineIndex: item.lineIndex,
              rawLine: item.rawLine,
              provider: item.provider,
              gameName: item.gameName,
              skuName: item.skuName,
              quantity: item.quantity,
              price: orderCost,
              success: false,
              error: fzrResult.error || 'FZR Cards rejected order'
            });
          } else {
            successCount++;
            totalSpent += orderCost;
            results.push({
              lineIndex: item.lineIndex,
              rawLine: item.rawLine,
              provider: item.provider,
              gameName: item.gameName,
              skuName: item.skuName,
              quantity: item.quantity,
              price: orderCost,
              playerName: fzrResult.order.playerName,
              success: true,
              referenceId: fzrResult.order.referenceId,
              orderId: fzrResult.order.providerOrderId || fzrResult.order.orderId,
              statusText: 'PROCESSING'
            });
          }
        } else if (item.provider === 'topupnation' && topupNationService) {
          // Execute TopupNation order
          const tpnResult = await topupNationService.placeOrder({
            telegramChatId: user.telegramChatId,
            telegramUsername: user.username,
            telegramFirstName: user.firstName,
            productId: item.gameId,
            sku: item.skuId,
            fields: item.extraInfo, skipBalanceDeduction: true,
            quantity: item.quantity
          });

          if (!tpnResult.success || !tpnResult.order) {
            // Refund if not API linked
            if (!isApiLinked) {
              await User.updateOne({ _id: user._id }, { $inc: { balance: orderCost } });
              currentBalance += orderCost;
            }
            failedCount++;
            results.push({
              lineIndex: item.lineIndex,
              rawLine: item.rawLine,
              provider: item.provider,
              gameName: item.gameName,
              skuName: item.skuName,
              quantity: item.quantity,
              price: orderCost,
              success: false,
              error: tpnResult.error || 'TopupNation rejected order'
            });
          } else {
            successCount++;
            totalSpent += orderCost;
            results.push({
              lineIndex: item.lineIndex,
              rawLine: item.rawLine,
              provider: item.provider,
              gameName: item.gameName,
              skuName: item.skuName,
              quantity: item.quantity,
              price: orderCost,
              playerName: tpnResult.order.playerName,
              success: true,
              referenceId: tpnResult.order.referenceId,
              orderId: tpnResult.order.providerOrderId || tpnResult.order.orderId,
              statusText: 'PROCESSING'
            });
          }
        } else {
          // Execute LootBar order
          const orderResponse = await lootbarClient.createOrder(
            referenceId,
            item.gameId,
            item.skuId,
            item.quantity,
            item.extraInfo
          );

          if (orderResponse?.status === 'ok' && orderResponse?.data?.order_id) {
            const orderId = orderResponse.data.order_id;
            
            // Extract player details
            let playerName = '';
            for (const [k, v] of Object.entries(item.extraInfo)) {
              const lk = k.toLowerCase();
              if (!playerName && (lk === 'player_name' || lk === 'role_name' || lk === 'nickname' || lk === 'playername' || lk === 'role')) {
                playerName = String(v);
              }
            }

            // Create Order record in DB
            try {
              await Order.create({
                referenceId,
                orderId,
                telegramChatId: user.telegramChatId,
                telegramUsername: user.username,
                telegramFirstName: user.firstName,
                gameId: item.gameId,
                gameName: item.gameName,
                skuId: item.skuId,
                skuName: item.skuName,
                playerName: playerName || undefined,
                price: orderCost,
                extraInfo: {
                  ...item.extraInfo,
                  quantity: item.quantity,
                  paymentSource: isApiLinked ? 'api_balance' : 'wallet_balance',
                  bulkBatchId: batchId
                },
                state: 1 // In transaction
              });
            } catch (dbErr) {
              console.error('Failed to create order record:', dbErr);
            }

            successCount++;
            totalSpent += orderCost;
            results.push({
              lineIndex: item.lineIndex,
              rawLine: item.rawLine,
              provider: 'lootbar',
              gameName: item.gameName,
              skuName: item.skuName,
              quantity: item.quantity,
              price: orderCost,
              playerName: playerName || undefined,
              success: true,
              referenceId,
              orderId,
              statusText: 'PROCESSING'
            });
          } else {
            // Failed: Refund balance
            if (!isApiLinked) {
              await User.updateOne({ _id: user._id }, { $inc: { balance: orderCost } });
              currentBalance += orderCost;
            }
            failedCount++;
            const errMsg = orderResponse?.message || orderResponse?.error || 'LootBar rejected order';
            results.push({
              lineIndex: item.lineIndex,
              rawLine: item.rawLine,
              provider: 'lootbar',
              gameName: item.gameName,
              skuName: item.skuName,
              quantity: item.quantity,
              price: orderCost,
              success: false,
              error: errMsg
            });
          }
        }
      } catch (err: any) {
        if (!isApiLinked) {
          await User.updateOne({ _id: user._id }, { $inc: { balance: orderCost } });
          currentBalance += orderCost;
        }
        failedCount++;
        results.push({
          lineIndex: item.lineIndex,
          rawLine: item.rawLine,
          provider: item.provider,
          gameName: item.gameName,
          skuName: item.skuName,
          quantity: item.quantity,
          price: orderCost,
          success: false,
          error: err.message || 'Network/Server Error'
        });
      }

      // Small throttle between orders to prevent flood
      await new Promise(res => setTimeout(res, 80));
    }

    const updatedUser = await User.findOne({ telegramChatId: user.telegramChatId });

    // Save batch history record to DB
    let savedBatch: IBulkOrderBatch | null = null;
    try {
      savedBatch = await BulkOrderBatch.create({
        batchId,
        telegramChatId: user.telegramChatId,
        telegramUsername: user.username,
        telegramFirstName: user.firstName,
        source: options?.source || 'bot',
        totalRequested: items.length,
        successCount,
        failedCount,
        totalSpent,
        userBalanceBefore: balanceBefore,
        userBalanceAfter: updatedUser?.balance ?? currentBalance,
        isApiLinked,
        rawText: options?.rawText,
        results
      });
    } catch (batchErr) {
      console.error('Failed to save BulkOrderBatch:', batchErr);
    }

    return {
      batchId,
      totalRequested: items.length,
      successCount,
      failedCount,
      totalSpent,
      userBalanceBefore: balanceBefore,
      userBalanceAfter: updatedUser?.balance ?? currentBalance,
      isApiLinked,
      results,
      createdAt: savedBatch?.createdAt || new Date()
    };
  }

  /**
   * Fetch paginated Bulk Order Batches for admin or user
   */
  public static async getBulkHistory(options: {
    telegramChatId?: number;
    page?: number;
    limit?: number;
  }): Promise<{
    batches: IBulkOrderBatch[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = Math.max(1, options.page || 1);
    const limit = Math.max(1, Math.min(100, options.limit || 10));
    const skip = (page - 1) * limit;

    const query: any = {};
    if (options.telegramChatId !== undefined && options.telegramChatId !== null) {
      query.telegramChatId = options.telegramChatId;
    }

    const [batches, total] = await Promise.all([
      BulkOrderBatch.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      BulkOrderBatch.countDocuments(query)
    ]);

    return {
      batches: batches as IBulkOrderBatch[],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1
    };
  }

  /**
   * Fetch single Bulk Order Batch details by ID
   */
  public static async getBulkBatchById(batchId: string): Promise<IBulkOrderBatch | null> {
    return (await BulkOrderBatch.findOne({ batchId }).lean()) as IBulkOrderBatch | null;
  }
}
