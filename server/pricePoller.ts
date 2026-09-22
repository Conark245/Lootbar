import { TopupNationService } from './providers/topupnation/TopupNationService';
import { G2BulkService } from './providers/g2bulk/G2BulkService';
import { TopupNationProduct } from './models/TopupNationProduct';
import { G2BulkProduct } from './models/G2BulkProduct';
import { User } from './models/User';
import { getNotificationSettings } from './notificationSettings';
import mongoose from 'mongoose';

export class PricePoller {
  private telegramNotifier?: (chatId: number, message: string) => Promise<void>;
  private topupNationService: TopupNationService;
  private g2bulkService?: G2BulkService;
  private isPolling = false;

  constructor(
    topupNationService: TopupNationService,
    g2bulkService?: G2BulkService
  ) {
    this.topupNationService = topupNationService;
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

      await this.checkTopupNationPrices();
      await this.checkG2BulkPrices();

    } catch (err) {
      console.error('Error polling prices:', err);
    } finally {
      this.isPolling = false;
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

        const settings = await getNotificationSettings();
        if (settings.priceChangeAlerts && settings.priceChangeTopupnation && settings.topupnationEnabled) {
          const users = await User.find({ isAuthorized: true });
          for (const u of users) {
             await this.telegramNotifier(u.telegramChatId, msg);
             await new Promise(r => setTimeout(r, 50));
          }
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
        
        const settings = await getNotificationSettings();
        if (settings.priceChangeAlerts && settings.priceChangeTopupnation && settings.topupnationEnabled) {
          const users = await User.find({ isAuthorized: true });
          for (const u of users) {
             await this.telegramNotifier(u.telegramChatId, msg);
             await new Promise(r => setTimeout(r, 50));
          }
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

        const settings = await getNotificationSettings();
        if (settings.priceChangeAlerts && settings.priceChangeG2bulk && settings.g2bulkEnabled) {
          const users = await User.find({ isAuthorized: true });
          for (const u of users) {
            if (u.telegramChatId) {
              await this.notify(u.telegramChatId, msg, 'G2Bulk');
            }
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
        
        const settings = await getNotificationSettings();
        if (settings.priceChangeAlerts && settings.priceChangeG2bulk && settings.g2bulkEnabled) {
          const users = await User.find({ isAuthorized: true });
          for (const u of users) {
            if (u.telegramChatId) {
              await this.notify(u.telegramChatId, msg, 'G2Bulk');
            }
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
      if (err.response?.status === 404) {
        console.warn(`[G2Bulk Price Poller] 404 Not Found at ${client.getStatus().baseUrl}. Check G2BULK_BASE_URL (default: https://api.g2bulk.com/v2).`);
      } else {
        console.error('Error in checkG2BulkPrices:', err.message || err);
      }
    }
  }

  private async notifyUsers(providerName: string, gameName: string, shortKey: string, changes: string[]) {
    if (!this.telegramNotifier) return;
    const settings = await getNotificationSettings();
    if (!settings.priceChangeAlerts) return;
    if (providerName === 'TopupNation' && (!settings.priceChangeTopupnation || !settings.topupnationEnabled)) return;
    if (providerName === 'G2Bulk' && (!settings.priceChangeG2bulk || !settings.g2bulkEnabled)) return;

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

  private async notify(chatId: number, msg: string, provider?: 'TopupNation' | 'G2Bulk') {
    if (!this.telegramNotifier) return;
    const settings = await getNotificationSettings();
    if (!settings.priceChangeAlerts) return;
    if (provider === 'TopupNation' && (!settings.priceChangeTopupnation || !settings.topupnationEnabled)) return;
    if (provider === 'G2Bulk' && (!settings.priceChangeG2bulk || !settings.g2bulkEnabled)) return;
    await this.telegramNotifier(chatId, msg).catch(() => {});
  }
}
