import { LootBarClient } from './lootbar';
import { TopupNationService } from './providers/topupnation/TopupNationService';
import { SavedGame } from './models/SavedGame';
import { TopupNationProduct } from './models/TopupNationProduct';
import { User } from './models/User';
import mongoose from 'mongoose';

export class PricePoller {
  private telegramNotifier?: (chatId: number, message: string) => Promise<void>;
  private lootbarClient: LootBarClient;
  private topupNationService: TopupNationService;
  private isPolling = false;

  constructor(lootbarClient: LootBarClient, topupNationService: TopupNationService) {
    this.lootbarClient = lootbarClient;
    this.topupNationService = topupNationService;
  }

  public setTelegram(telegramBot: any) {
    this.telegramNotifier = async (chatId: number, message: string) => {
      try {
        await telegramBot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } catch (err) {
        console.error(`Failed to notify user ${chatId} about price changes`, err);
      }
    };
  }

  public async pollPrices() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      if (mongoose.connection.readyState !== 1) return; // Need DB

      await this.checkLootbarPrices();
      await this.checkTopupNationPrices();
    } catch (err) {
      console.error('Error polling prices:', err);
    } finally {
      this.isPolling = false;
    }
  }

  private async notifyUsers(provider: string, gameName: string, shortKey: string, changes: string[]) {
    if (!this.telegramNotifier || changes.length === 0) return;

    // Get all authorized users
    const users = await User.find({ isAuthorized: true });
    if (!users || users.length === 0) return;

    const message = `📈 *Price Update Alert* (${provider})\n` +
      `🎮 Game: *${gameName.replace(/[*_`\[\]]/g, '')}* (\`.${shortKey}\`)\n\n` +
      `The following packages have updated prices:\n` +
      changes.join('\n') +
      `\n\n_Note: The Bot has already updated its prices automatically. You will see these new prices when placing an order._`;

    for (const user of users) {
      await this.telegramNotifier(user.telegramChatId, message);
      // Small delay to prevent rate-limiting
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }

  private async checkLootbarPrices() {
    if (!this.lootbarClient.isConfigured()) return;

    const enabledGames = await SavedGame.find({ isEnabled: { $ne: false } });
    
    for (const game of enabledGames) {
      try {
        const response = await this.lootbarClient.getSkus(game.gameId);
        const latestSkus = response?.data?.items || [];
        
        if (latestSkus.length > 0) {
          if (game.lastKnownSkus && game.lastKnownSkus.length > 0) {
            const changes: string[] = [];
            
            for (const newSku of latestSkus) {
              const oldSku = game.lastKnownSkus.find((s: any) => s.sku_id === newSku.sku_id);
              if (oldSku) {
                const oldPrice = parseFloat(oldSku.reseller_price || oldSku.price || '0');
                const newPrice = parseFloat(newSku.reseller_price || newSku.price || '0');
                
                if (oldPrice !== newPrice) {
                  const name = (newSku.sku_name || newSku.name || 'Package').replace(/[*_`\[\]]/g, '');
                  const indicator = newPrice > oldPrice ? '🔴 🔺' : '🟢 🔻';
                  changes.push(`• ${name}: \`$${oldPrice.toFixed(2)}\` ➔ \`$${newPrice.toFixed(2)}\` ${indicator}`);
                }
              }
            }

            if (changes.length > 0) {
              await this.notifyUsers('LootBar', game.name, game.shortKey || '', changes);
            }
          }
          
          game.lastKnownSkus = latestSkus;
          await game.save();
        }
      } catch (err) {
        // Skip silently on error so it doesn't crash the loop
      }
    }
  }

  private async checkTopupNationPrices() {
    const tpnClient = this.topupNationService.getClient();
    if (!tpnClient || !tpnClient.isConfigured()) return;

    try {
      const liveProducts = await tpnClient.getProducts();
      
      const enabledProducts = await TopupNationProduct.find({ isEnabled: { $ne: false } });

      for (const p of enabledProducts) {
        const liveMatch = liveProducts.find((live: any) => String(live.productId) === String(p.productId));
        if (liveMatch && liveMatch.skus && liveMatch.skus.length > 0) {
          const changes: string[] = [];
          
          // Compare SKUs
          for (const newSku of liveMatch.skus) {
            const oldSku = (p.skus || []).find((s: any) => String(s.sku) === String(newSku.sku));
            if (oldSku) {
              const oldPrice = parseFloat(String(oldSku.price || '0'));
              const newPrice = parseFloat(String(newSku.price || '0'));
              
              if (oldPrice !== newPrice) {
                const name = (newSku.name || 'Package').replace(/[*_`\[\]]/g, '');
                const indicator = newPrice > oldPrice ? '🔴 🔺' : '🟢 🔻';
                changes.push(`• ${name}: \`$${oldPrice.toFixed(2)}\` ➔ \`$${newPrice.toFixed(2)}\` ${indicator}`);
              }
            }
          }

          if (changes.length > 0) {
            await this.notifyUsers('TopupNation', p.name, p.shortKey || '', changes);
          }

          // Update DB with latest data
          p.name = liveMatch.name;
          p.status = liveMatch.status || 'ACTIVE';
          p.category = liveMatch.category;
          p.description = liveMatch.description;
          p.iconUrl = liveMatch.iconUrl;
          p.fields = liveMatch.fields || [];
          p.skus = liveMatch.skus || [];
          p.lastSyncedAt = new Date();
          await p.save();
        }
      }
    } catch (err) {
      // Skip silently
    }
  }
}
