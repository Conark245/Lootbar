import { v4 as uuidv4 } from 'uuid';
import { TopupNationService } from './providers/topupnation/TopupNationService';
import { G2BulkService } from './providers/g2bulk/G2BulkService';
import { TopupNationProduct } from './models/TopupNationProduct';
import { G2BulkProduct } from './models/G2BulkProduct';
import { Order } from './models/Order';
import { User, IUser } from './models/User';
import { BulkOrderBatch, IBulkOrderBatch } from './models/BulkOrderBatch';
import { parseSkuWithQuantity } from './bot/matching';
import { parseCommandArgs, isProviderApiLinked } from './bot/helpers';

export interface BulkOrderItem {
  lineIndex: number;
  rawLine: string;
  provider: 'topupnation' | 'g2bulk';
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
  provider: 'topupnation' | 'g2bulk';
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

/**
 * Service to parse and execute Bulk Top-Up orders uniformly across Bot & Web Dashboard
 */
export class BulkOrderService {
  /**
   * Parse multi-line bulk order text into validated BulkOrderItems
   */
  public static async parseBulkText(
    rawText: string
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

    // Cache database lookups for speed
    const tpnProducts = await TopupNationProduct.find();
    const g2bProducts = await G2BulkProduct.find();

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

      // Check TopupNation Products
      const matchedTpn = tpnProducts.find((p: any) => {
        const k = (p.shortKey || '').toLowerCase();
        return k === inputKey || String(p.productId).toLowerCase() === inputKey;
      });

      if (matchedTpn) {
        if (matchedTpn.isEnabled === false || matchedTpn.status === 'DISABLED') {
          errors.push({
            lineIndex,
            rawLine: rawLines[i],
            error: `Game "${matchedTpn.name}" (TopupNation) is currently disabled by Admin.`
          });
          continue;
        }

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

      // Check G2Bulk Products
      const matchedG2b = g2bProducts.find((p: any) => {
        const k = (p.shortKey || '').toLowerCase();
        return k === inputKey || String(p.productId).toLowerCase() === inputKey;
      });

      if (matchedG2b) {
        if (matchedG2b.isEnabled === false || matchedG2b.status === 'DISABLED') {
          errors.push({
            lineIndex,
            rawLine: rawLines[i],
            error: `Game "${matchedG2b.name}" (G2Bulk) is currently disabled by Admin.`
          });
          continue;
        }

        const productId = String(matchedG2b.productId);
        const productName = matchedG2b.name || 'Game';
        const skus = (matchedG2b.skus || []).filter((s: any) => s.available !== false && s.availability !== false);

        if (skus.length === 0) {
          errors.push({
            lineIndex,
            rawLine: rawLines[i],
            error: `No packages available for ${productName} (G2Bulk)`
          });
          continue;
        }

        const requiredFields = (matchedG2b.fields || []).filter((f: any) => f.required);
        const minFields = requiredFields.length > 0 ? requiredFields.length : 1;

        if (rawArgs.length < minFields + 1) {
          errors.push({
            lineIndex,
            rawLine: rawLines[i],
            error: `Missing parameters for ${productName} (G2Bulk). Need ${minFields} account field(s) + Package.`
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
        if (matchedG2b.skuShortKeys) {
          if (matchedG2b.skuShortKeys instanceof Map || typeof (matchedG2b.skuShortKeys as any).entries === 'function') {
            skuKeys = Object.fromEntries((matchedG2b.skuShortKeys as any).entries());
          } else if (typeof matchedG2b.skuShortKeys === 'object') {
            skuKeys = { ...matchedG2b.skuShortKeys };
          }
        }

        const parsedResult = parseSkuWithQuantity(skus, rawProductQuery, skuKeys, true);
        const matchedSku = parsedResult.sku;
        const quantity = Math.max(1, Math.min(100, parsedResult.quantity || 1));

        if (!matchedSku) {
          errors.push({
            lineIndex,
            rawLine: rawLines[i],
            error: `Package "${rawProductQuery}" not found for ${productName} (G2Bulk)`
          });
          continue;
        }

        const unitPrice = typeof matchedSku.price === 'number' ? matchedSku.price : parseFloat(String(matchedSku.price || '0'));
        const totalPrice = unitPrice * quantity;

        validItems.push({
          lineIndex,
          rawLine: rawLines[i],
          provider: 'g2bulk',
          gameId: productId,
          gameName: productName,
          skuId: String(matchedSku.sku),
          skuName: matchedSku.name || `${productName} Package`,
          unitPrice,
          quantity,
          totalPrice,
          extraInfo,
          playerName: extraInfo['player_id'] || rawArgs[0]
        });
        continue;
      }

      // Neither TopupNation nor G2Bulk matched
      errors.push({
        lineIndex,
        rawLine: rawLines[i],
        error: `Unknown game shortKey: "${inputKey}". Send .tpn or .g2bulk to see available shortcuts.`
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
    topupNationService?: TopupNationService,
    g2bulkService?: G2BulkService,
    options?: { rawText?: string; source?: 'bot' | 'web' }
  ): Promise<BulkExecuteSummary> {
    const balanceBefore = user.balance || 0;
    let currentBalance = balanceBefore;
    let totalSpent = 0;
    let successCount = 0;
    let failedCount = 0;
    const results: BulkExecuteItemResult[] = [];
    const batchId = 'BULK-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();

    for (const item of items) {
      const orderCost = item.totalPrice;
      const itemProvider = item.provider || 'topupnation';
      const isApiLinked = isProviderApiLinked(user, itemProvider);

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

      try {
        if (item.provider === 'topupnation' && topupNationService) {
          // Execute TopupNation order
          const tpnResult = await topupNationService.placeOrder({
            telegramChatId: user.telegramChatId,
            telegramUsername: user.username,
            telegramFirstName: user.firstName,
            productId: item.gameId,
            sku: item.skuId,
            fields: item.extraInfo,
            skipBalanceDeduction: true,
            quantity: item.quantity
          });

          if (!tpnResult.success || !tpnResult.order) {
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
        } else if (item.provider === 'g2bulk' && g2bulkService) {
          // Execute G2Bulk order
          const userAccount = item.playerName || item.extraInfo['player_id'] || item.extraInfo['userAccount'] || item.extraInfo['uid'] || '';
          const g2bResult = await g2bulkService.placeOrder(
            userAccount,
            String(user._id),
            item.gameId,
            item.skuId,
            item.extraInfo,
            user.telegramChatId
          );

          if (!g2bResult.success || !g2bResult.order) {
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
              error: g2bResult.error || 'G2Bulk rejected order'
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
              playerName: g2bResult.order.playerName,
              success: true,
              referenceId: g2bResult.order.referenceId,
              orderId: g2bResult.order.providerOrderId || g2bResult.order.orderId,
              statusText: 'PROCESSING'
            });
          }
        } else {
          // Unsupported provider or missing service
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
            error: `Provider ${item.provider} service unavailable`
          });
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
    const isApiLinked = items.length > 0 && items.every(item => isProviderApiLinked(user, item.provider));

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
