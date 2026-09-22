import { AppConfig } from './models/AppConfig';

export interface INotificationSettings {
  lootbarEnabled: boolean;       // Notifications for LootBar (order completed/failed)
  topupnationEnabled: boolean;  // Notifications for TopupNation (order completed/failed)
  g2bulkEnabled: boolean;       // Notifications for G2Bulk (order completed/failed)
  adminOrderAlerts: boolean;    // Alerts sent to Telegram Admin when a new order/bulk order is placed
  priceChangeAlerts: boolean;   // Master price change / catalog update alerts
  priceChangeLootbar: boolean;      // Price changes for LootBar
  priceChangeTopupnation: boolean; // Price changes for TopupNation
  priceChangeG2bulk: boolean;      // Price changes for G2Bulk
}

export const DEFAULT_NOTIFICATION_SETTINGS: INotificationSettings = {
  lootbarEnabled: true,
  topupnationEnabled: true,
  g2bulkEnabled: true,
  adminOrderAlerts: true,
  priceChangeAlerts: true,
  priceChangeLootbar: true,
  priceChangeTopupnation: true,
  priceChangeG2bulk: true,
};

const CONFIG_KEY = 'notification_settings';

export async function getNotificationSettings(): Promise<INotificationSettings> {
  try {
    const config = await AppConfig.findOne({ key: CONFIG_KEY });
    if (config && config.value) {
      return {
        lootbarEnabled: config.value.lootbarEnabled ?? true,
        topupnationEnabled: config.value.topupnationEnabled ?? true,
        g2bulkEnabled: config.value.g2bulkEnabled ?? true,
        adminOrderAlerts: config.value.adminOrderAlerts ?? true,
        priceChangeAlerts: config.value.priceChangeAlerts ?? true,
        priceChangeLootbar: config.value.priceChangeLootbar ?? true,
        priceChangeTopupnation: config.value.priceChangeTopupnation ?? true,
        priceChangeG2bulk: config.value.priceChangeG2bulk ?? true,
      };
    }
  } catch (err) {
    console.error('Error reading notification settings:', err);
  }
  return { ...DEFAULT_NOTIFICATION_SETTINGS };
}

export async function updateNotificationSettings(
  partial: Partial<INotificationSettings>
): Promise<INotificationSettings> {
  const current = await getNotificationSettings();
  const updated: INotificationSettings = {
    ...current,
    ...partial,
  };

  await AppConfig.findOneAndUpdate(
    { key: CONFIG_KEY },
    { key: CONFIG_KEY, value: updated },
    { upsert: true, new: true }
  );

  return updated;
}
