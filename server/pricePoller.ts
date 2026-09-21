import { LootBarClient } from './providers/lootbar/LootBarClient';
import { TopupNationService } from './providers/topupnation/TopupNationService';
import { FzrCardsService } from './providers/fzrcards/FzrCardsService';
import { G2BulkService } from './providers/g2bulk/G2BulkService';
import { SavedGame } from './models/SavedGame';
import { TopupNationProduct } from './models/TopupNationProduct';
import { FzrCardsProduct } from './models/FzrCardsProduct';
import { G2BulkProduct } from './models/G2BulkProduct';
import { User } from './models/User';
import mongoose from 'mongoose';

export class PricePoller {
  private telegramNotifier?: (chatId: number, message: string) => Promise<void>;
  private lootbarClient: LootBarClient;
  private topupNationService: TopupNationService;
  private fzrCardsService?: FzrCardsService;
  private g2bulkService?: G2BulkService;
  private isPolling = false;

  constructor(
    lootbarClient: LootBarClient,
    topupNationService: TopupNationService,
    fzrCardsService?: FzrCardsService,
    g2bulkService?: G2BulkService
  ) {
    this.lootbarClient = lootbarClient;
    this.topupNationService = topupNationService;
    this.fzrCardsService = fzrCardsService;
    this.g2bulkService = g2bulkService;
  }

  public setTelegram(bot: any) {
    this.telegramNotifier = (chatId: number | string, message: string) => bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  }

  public async pollPrices() {
    if (this.isPolling) return;
    this.isPolling = true;

    try {
      if (mongoose.connection.readyState !== 1) return; // Need DB

      await this.checkLootbarPrices();
      await this.checkTopupNationPrices();
      await this.checkFzrCardsPrices();
      await this.checkG2BulkPrices();

    } catch (err) {
      console.error('Error polling prices:', err);
    } finally {
      this.isPolling = false;
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
                  changes.push(`• ${name}: \`$${oldPrice.toFixed(3)}\` ➔ \`$${newPrice.toFixed(3)}\` ${indicator}`);
                }
              } else {
                // New SKU logic
                const newPrice = parseFloat(newSku.reseller_price || newSku.price || '0');
                const name = (newSku.sku_name || newSku.name || 'Package').replace(/[*_`\[\]]/g, '');
                changes.push(`• 🆕 ${name} (New): \`$${newPrice.toFixed(3)}\``);
              }
            }

            // Detect removed SKUs
            for (const oldSku of game.lastKnownSkus) {
              const stillExists = latestSkus.find((s: any) => s.sku_id === oldSku.sku_id);
              if (!stillExists) {
                const name = (oldSku.sku_name || oldSku.name || 'Package').replace(/[*_`\[\]]/g, '');
                changes.push(`• 🗑️ ${name} (Removed)`);
              }
            }

            if (changes.length > 0) {
              await this.notifyUsers('LootBar', game.name, game.shortKey || '', changes);
            }
          }
          
          await SavedGame.updateOne(
            { _id: game._id },
            { $set: { lastKnownSkus: latestSkus } }
          );
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
      
      // Safeguard: Ensure API is returning data before attempting deletes
      if (!liveProducts || liveProducts.length === 0) return;

      const allDbProducts = await TopupNationProduct.find({});

      // 1. Detect removed games
      const removedDbProducts = allDbProducts.filter(p => !liveProducts.find((live: any) => String(live.productId) === String(p.productId)));
      if (removedDbProducts.length > 0 && this.telegramNotifier) {
        const removedNames = removedDbProducts.map((p: any) => {
            const safeName = (p.name || 'Game').replace(/[*_`\[\]]/g, '');
            return `• 🗑️ *${safeName}*`;
        });
        const msg = `🗑️ *Games Removed from TopupNation!*\n\nThe following games are no longer available on the API and have been deleted from the Bot:\n${removedNames.slice(0, 30).join('\n')}${removedNames.length > 30 ? '\n...and more' : ''}`;
        
        await TopupNationProduct.deleteMany({ _id: { $in: removedDbProducts.map(p => p._id) } });

        const users = await User.find({ isAuthorized: true });
        for (const u of users) {
           await this.telegramNotifier(u.telegramChatId, msg);
           await new Promise(r => setTimeout(r, 50));
        }
      }

      // 2. Detect brand new games
      const newLiveProducts = liveProducts.filter((live: any) => !allDbProducts.find(p => String(p.productId) === String(live.productId)));
      if (newLiveProducts.length > 0 && this.telegramNotifier) {
        const newGameNames = newLiveProducts.map((p: any) => {
            const safeName = (p.name || 'Game').replace(/[*_`\[\]]/g, '');
            return `• 🎮 *${safeName}*`;
        });
        const msg = `🌟 *New Games Available on TopupNation!*\n\nThe following games were just added to the API:\n${newGameNames.slice(0, 30).join('\n')}${newGameNames.length > 30 ? '\n...and more' : ''}\n\n_Note: They have been automatically synced to the database. Configure them in Admin Panel._`;
        
        const users = await User.find({ isAuthorized: true });
        for (const u of users) {
           await this.telegramNotifier(u.telegramChatId, msg);
           await new Promise(r => setTimeout(r, 50));
        }
        await this.topupNationService.syncCatalog(); // Auto sync them to DB so we don't notify again
      }

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
                changes.push(`• ${name}: \`$${oldPrice.toFixed(3)}\` ➔ \`$${newPrice.toFixed(3)}\` ${indicator}`);
              }
            } else {
              // New SKU logic
              const newPrice = parseFloat(String(newSku.price || '0'));
              const name = (newSku.name || 'Package').replace(/[*_`\[\]]/g, '');
              changes.push(`• 🆕 ${name} (New): \`$${newPrice.toFixed(3)}\``);
            }
          }

          // Detect removed SKUs
          for (const oldSku of p.skus || []) {
            const stillExists = liveMatch.skus.find((s: any) => String(s.sku) === String(oldSku.sku));
            if (!stillExists) {
              const name = (oldSku.name || 'Package').replace(/[*_`\[\]]/g, '');
              changes.push(`• 🗑️ ${name} (Removed)`);
            }
          }

          if (changes.length > 0) {
            await this.notifyUsers('TopupNation', p.name, p.shortKey || '', changes);
          }

          // Update DB with latest data via updateOne to prevent VersionError
          await TopupNationProduct.updateOne(
            { _id: p._id },
            {
              $set: {
                name: liveMatch.name,
                status: liveMatch.status || 'ACTIVE',
                category: liveMatch.category,
                description: liveMatch.description,
                iconUrl: liveMatch.iconUrl,
                fields: liveMatch.fields || [],
                skus: liveMatch.skus || [],
                lastSyncedAt: new Date()
              }
            }
          );
        }
      }
    } catch (err: any) {
      console.error('Error in checkTopupNationPrices:', err.message || err);
    }
  }

  private async checkFzrCardsPrices() {
    if (!this.fzrCardsService) return;
    const fzrClient = this.fzrCardsService.getClient();
    if (!fzrClient || !fzrClient.isConfigured()) return;
    if (fzrClient.getSubscriptionStatus && !fzrClient.getSubscriptionStatus().isActive) return;

    try {
      const liveProducts = await fzrClient.getProducts();

      // Safeguard: Ensure API is returning data before attempting deletes
      if (!liveProducts || liveProducts.length === 0) return;

      const allDbProducts = await FzrCardsProduct.find({});

      // 1. Detect removed games
      const removedDbProducts = allDbProducts.filter(p => !liveProducts.find((live: any) => String(live.productId) === String(p.productId)));
      if (removedDbProducts.length > 0 && this.telegramNotifier) {
        const removedNames = removedDbProducts.map((p: any) => {
            const safeName = (p.name || 'Game').replace(/[*_`\[\]]/g, '');
            return `• 🗑️ *${safeName}*`;
        });
        const msg = `🗑️ *Games Removed from FZR Cards!*\n\nThe following games are no longer available on the API and have been deleted from the Bot:\n${removedNames.slice(0, 30).join('\n')}${removedNames.length > 30 ? '\n...and more' : ''}`;
        
        await FzrCardsProduct.deleteMany({ _id: { $in: removedDbProducts.map(p => p._id) } });

        const users = await User.find({ isAuthorized: true });
        for (const u of users) {
           await this.telegramNotifier(u.telegramChatId, msg);
           await new Promise(r => setTimeout(r, 50));
        }
      }

      // 2. Detect brand new games
      const newLiveProducts = liveProducts.filter((live: any) => !allDbProducts.find(p => String(p.productId) === String(live.productId)));
      
      if (newLiveProducts.length > 0 && this.telegramNotifier) {
        const newGameNames = newLiveProducts.map((p: any) => {
            const safeName = (p.name || 'Game').replace(/[*_`\[\]]/g, '');
            return `• 🎮 *${safeName}*`;
        });
        const msg = `🌟 *New Games Available on FZR Cards!*\n\nThe following games were just added to the API:\n${newGameNames.slice(0, 30).join('\n')}${newGameNames.length > 30 ? '\n...and more' : ''}\n\n_Note: They have been automatically synced to the database. Configure them in Admin Panel._`;
        
        const users = await User.find({ isAuthorized: true });
        for (const u of users) {
           await this.telegramNotifier(u.telegramChatId, msg);
           await new Promise(r => setTimeout(r, 50));
        }
        await this.fzrCardsService?.syncCatalog(); // Auto sync them to DB so we don't notify again
      }

      const enabledProducts = await FzrCardsProduct.find({ isEnabled: { $ne: false } });

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
                changes.push(`• ${name}: \`$${oldPrice.toFixed(3)}\` ➔ \`$${newPrice.toFixed(3)}\` ${indicator}`);
              }
            } else {
              // New SKU logic
              const newPrice = parseFloat(String(newSku.price || '0'));
              const name = (newSku.name || 'Package').replace(/[*_`\[\]]/g, '');
              changes.push(`• 🆕 ${name} (New): \`$${newPrice.toFixed(3)}\``);
            }
          }

          // Detect removed SKUs
          for (const oldSku of p.skus || []) {
            const stillExists = liveMatch.skus.find((s: any) => String(s.sku) === String(oldSku.sku));
            if (!stillExists) {
              const name = (oldSku.name || 'Package').replace(/[*_`\[\]]/g, '');
              changes.push(`• 🗑️ ${name} (Removed)`);
            }
          }

          if (changes.length > 0) {
            await this.notifyUsers('FZR Cards', p.name, p.shortKey || '', changes);
          }

          // Update DB with latest data via updateOne to prevent VersionError
          await FzrCardsProduct.updateOne(
            { _id: p._id },
            {
              $set: {
                name: liveMatch.name,
                status: liveMatch.status || 'ACTIVE',
                category: liveMatch.category,
                description: liveMatch.description,
                iconUrl: liveMatch.iconUrl,
                fields: liveMatch.fields || [],
                skus: liveMatch.skus || [],
                lastSyncedAt: new Date()
              }
            }
          );
        }
      }
    } catch (err) {
      // Skip silently
    }
  }

  private async checkG2BulkPrices() {
    if (!this.g2bulkService) return;
    const client = this.g2bulkService.getClient();
    if (!client || !client.getStatus().isConfigured) return;

    try {
      const liveProducts = await client.getProducts();
      if (!liveProducts || liveProducts.length === 0) return;

      const allDbProducts = await G2BulkProduct.find({});
      
      const removedDbProducts = allDbProducts.filter(p => !liveProducts.find((live: any) => String(live.productId) === String(p.productId)));
      if (removedDbProducts.length > 0) {
        const removedNames = removedDbProducts.map(p => {
            const safeName = (p.name || 'Game').replace(/[*_`\[\]]/g, '');
            return `• 🗑️ *${safeName}*`;
        });
        const msg = `🗑️ *Games Removed from G2Bulk!*\n\nThe following games are no longer available on the API and have been deleted from the Bot:\n${removedNames.slice(0, 30).join('\n')}${removedNames.length > 30 ? '\n...and more' : ''}`;
        
        await G2BulkProduct.deleteMany({ _id: { $in: removedDbProducts.map(p => p._id) } });

        const users = await User.find({ isAuthorized: true });
        for (const u of users) {
          if (u.telegramChatId) {
            await this.notify(u.telegramChatId, msg);
          }
        }
      }

      const newLiveProducts = liveProducts.filter((live: any) => !allDbProducts.find(p => String(p.productId) === String(live.productId)));
      if (newLiveProducts.length > 0) {
        const newGameNames = newLiveProducts.map((p: any) => {
            const safeName = (p.name || 'Game').replace(/[*_`\[\]]/g, '');
            return `• 🎮 *${safeName}*`;
        });
        const msg = `🌟 *New Games Available on G2Bulk!*\n\nThe following games were just added to the API:\n${newGameNames.slice(0, 30).join('\n')}${newGameNames.length > 30 ? '\n...and more' : ''}\n\n_Note: They have been automatically synced to the database. Configure them in Admin Panel._`;
        
        const users = await User.find({ isAuthorized: true });
        for (const u of users) {
          if (u.telegramChatId) {
            await this.notify(u.telegramChatId, msg);
          }
        }
        await this.g2bulkService.syncCatalog();
      }

      const enabledProducts = await G2BulkProduct.find({ isEnabled: { $ne: false } });
      for (const p of enabledProducts) {
        const liveMatch = liveProducts.find((live: any) => String(live.productId) === String(p.productId));
        if (liveMatch && liveMatch.skus) {
          let hasChanges = false;
          let changes: string[] = [];

          for (const liveSku of liveMatch.skus) {
            const dbSku = p.skus.find((s: any) => String(s.sku) === String(liveSku.sku));
            if (dbSku && dbSku.price !== liveSku.price) {
              const oldPrice = Number(dbSku.price).toFixed(3);
              const newPrice = Number(liveSku.price).toFixed(3);
              const diff = Number(liveSku.price) - Number(dbSku.price);
              const trend = diff > 0 ? '📈 `+$' + diff.toFixed(3) + '`' : '📉 `-$' + Math.abs(diff).toFixed(3) + '`';
              
              changes.push(`• ${dbSku.name}\n  ` + 
                (diff > 0 ? '🔴' : '🟢') +
                ` ` +
                `~$${oldPrice} -> $${newPrice} USD~ ${trend}`);
              dbSku.price = liveSku.price;
              hasChanges = true;
            }
          }

          if (hasChanges) {
            await G2BulkProduct.updateOne({ _id: p._id }, { $set: { skus: p.skus, lastSyncedAt: new Date() } });
            await this.notifyUsers('G2Bulk', p.name, p.shortKey || '', changes);
          }
        }
      }
    } catch (err: any) {
      console.error('Error in checkG2BulkPrices:', err.message || err);
    }
  }

  private async notifyUsers(providerName: string, gameName: string, shortKey: string, changes: string[]) {
    if (!this.telegramNotifier) return;
    const safeName = gameName.replace(/[*_`\[\]]/g, '');
    const skInfo = shortKey ? ` (\`.${shortKey}\`)` : '';
    const msg = `🔔 *${providerName} Price Update*\n\n🎮 *${safeName}*${skInfo}\n\n${changes.join('\n\n')}`;
    
    const users = await User.find({ isAuthorized: true, receivesNotifications: { $ne: false } });
    for (const u of users) {
      if (u.telegramChatId) {
        await this.telegramNotifier(u.telegramChatId, msg).catch(() => {});
      }
    }
  }

  private async notify(chatId: number, msg: string) {
    if (this.telegramNotifier) {
      await this.telegramNotifier(chatId, msg).catch(() => {});
    }
  }
}
