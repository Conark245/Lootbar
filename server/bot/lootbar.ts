import { Telegraf, Markup } from 'telegraf';
import { LootBarClient } from '../providers/lootbar/LootBarClient';
import { SavedGame } from '../models/SavedGame';
import { MyContext } from './types';
import { getGameDefaultShortKey } from './helpers';
import { parseSkuWithQuantity } from './matching';

// Text-only Game List handler for LootBar (No buttons, Owner-enabled only)
export async function renderLootBarGameList(ctx: MyContext, lootbar: LootBarClient) {
  try {
    let savedGames = await SavedGame.find({ isEnabled: { $ne: false } }).sort({ savedAt: -1 });

    if (!savedGames || savedGames.length === 0) {
      const anyGames = await SavedGame.countDocuments();
      if (anyGames === 0) {
        const response = await lootbar.getGames();
        const allGames = response?.data?.items || [];
        if (allGames.length > 0) {
          for (const g of allGames.slice(0, 6)) {
            const gId = String(g.id || g.game_id);
            const gName = g.name || g.game_name || 'Game';
            const shortKey = getGameDefaultShortKey(gName, gId);
            await SavedGame.findOneAndUpdate(
              { gameId: gId },
              { name: gName, shortKey, isEnabled: true },
              { upsert: true, returnDocument: 'after' }
            );
          }
          savedGames = await SavedGame.find({ isEnabled: { $ne: false } }).sort({ savedAt: -1 });
        }
      }
    }

    if (!savedGames || savedGames.length === 0) {
      return ctx.reply('⚠️ No LootBar games are currently enabled by the Owner. Please contact the administrator.');
    }

    let msg = `🎮 *LootBar API — ရရှိနိုင်သော Games စာရင်း*\n\n` +
      `အောက်ပါ Game များအား Top-Up ဝယ်ယူနိုင်ပါသည်။ Product စာရင်း ကြည့်ရှုရန် သို့မဟုတ် အော်ဒါတင်ရန် သက်ဆိုင်ရာ *Short Key* ဖြင့် အသုံးပြုနိုင်ပါသည်:\n\n`;

    const numEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

    savedGames.forEach((game: any, index: number) => {
      const shortKey = (game.shortKey || getGameDefaultShortKey(game.name, game.gameId)).toLowerCase();
      const numEmoji = numEmojis[index] || `🔹`;

      let example = `.${shortKey} 123456789 60`;
      let format = `.${shortKey} <UID> <Product>`;
      const lowerName = game.name.toLowerCase();

      if (lowerName.includes('mobile legends') || lowerName.includes('mlbb')) {
        example = `.${shortKey} 12345678 2001 86`;
        format = `.${shortKey} <UID> <ZoneID> <Product>`;
      } else if (lowerName.includes('genshin') || lowerName.includes('star rail')) {
        example = `.${shortKey} 812345678 60`;
        format = `.${shortKey} <UID> <Product>`;
      } else if (lowerName.includes('free fire')) {
        example = `.${shortKey} 987654321 100`;
        format = `.${shortKey} <UID> <Product>`;
      }

      msg += `${numEmoji} *${game.name}*\n` +
        `   ▫️ *Short Key:* \`.${shortKey}\`\n` +
        `   ▫️ *Packages ကြည့်ရန်:* \`.${shortKey}\`\n` +
        `   ▫️ *Order တင်ရန်:* \`${format}\`\n` +
        `   ▫️ *ဥပမာ:* \`${example}\`\n\n`;
    });

    msg += `━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 *အသုံးပြုနည်း လမ်းညွှန်:*\n` +
      `• Packages & Prices ကြည့်ရှုရန်: \`.<shortKey>\` (ဥပမာ \`.p\`)\n` +
      `• တိုက်ရိုက် Order တင်ရန်: \`.<shortKey> <UID> <Product>\``;

    return ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error: any) {
    console.error('Failed to fetch LootBar text game list:', error);
    return ctx.reply(`An error occurred while fetching the LootBar game list: ${error.message}`);
  }
}

// Display packages & prices for a specific game when sending .<shortKey>
export async function handleGamePackageList(ctx: MyContext, game: any, shortKey: string, lootbar: LootBarClient) {
  try {
    const gameId = String(game.gameId || game.game_id);
    const gameName = game.name || game.game_name || 'Game';

    const response = await lootbar.getSkus(gameId);
    const skus = response?.data?.items || [];

    if (!skus || skus.length === 0) {
      return ctx.reply(`⚠️ No packages available for *${gameName}* at the moment from LootBar.`, { parse_mode: 'Markdown' });
    }

    const requiredFields = (skus[0]?.extra_info || []).filter((f: any) => f.required);
    let orderFormatDesc = `.${shortKey} <UID> <Product>`;
    let exampleDesc = `.${shortKey} 123456789 60`;

    if (requiredFields.length === 2) {
      const f1 = requiredFields[0].title || requiredFields[0].name || 'UID';
      const f2 = requiredFields[1].title || requiredFields[1].name || 'ZoneID';
      orderFormatDesc = `.${shortKey} <${f1}> <${f2}> <Product>`;
      exampleDesc = `.${shortKey} 12345678 2001 86`;
    } else if (requiredFields.length > 2) {
      const fieldsList = requiredFields.map((f: any) => `<${f.title || f.name}>`).join(' ');
      orderFormatDesc = `.${shortKey} ${fieldsList} <Product>`;
    }

    let skuKeys: Record<string, string> = {};
    if (game.skuShortKeys) {
      skuKeys = typeof game.skuShortKeys.get === 'function' 
        ? Object.fromEntries(game.skuShortKeys) 
        : (game.skuShortKeys || {});
    }

    let msg = `🎮 *${gameName} — Packages & Prices*\n\n` +
      `📦 *ရရှိနိုင်သော Products စာရင်း:*\n`;

    skus.forEach((sku: any) => {
      const name = sku.sku_name || `Product #${sku.sku_id}`;
      const price = sku.reseller_price || sku.price || '0.00';
      const customKey = skuKeys[String(sku.sku_id)];
      const shortKeyTag = customKey ? ` (Key: \`${customKey}\`)` : '';
      msg += `▫️ *${name}* — \`$${Number(price).toFixed(3)} USD\`${shortKeyTag}\n`;
    });

    msg += `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `🛒 *Order တင်ရန် Command Format:*\n` +
      `\`${orderFormatDesc}\`\n\n` +
      `👉 *ဥပမာ:* \`${exampleDesc}\`\n` +
      `━━━━━━━━━━━━━━━━━━━━`;

    return ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (err: any) {
    console.error('Error fetching game packages:', err);
    return ctx.reply(`❌ Error fetching package list: ${err.message}`);
  }
}

// Direct order placement using Owner-defined Short Key
export async function handleGameDirectOrder(
  ctx: MyContext,
  game: any,
  shortKey: string,
  args: string[],
  lootbar: LootBarClient,
  showOrderConfirmation: (ctx: MyContext) => Promise<any>
) {
  try {
    const gameId = String(game.gameId || game.game_id);
    const gameName = game.name || game.game_name || 'Game';

    const response = await lootbar.getSkus(gameId);
    const skus = response?.data?.items || [];

    if (!skus || skus.length === 0) {
      return ctx.reply(`⚠️ No packages available for *${gameName}* at the moment.`, { parse_mode: 'Markdown' });
    }

    const requiredFields = (skus[0]?.extra_info || []).filter((f: any) => f.required);
    const minFields = requiredFields.length > 0 ? requiredFields.length : 1;

    if (args.length < minFields) {
      let formatHelp = `.${shortKey} <UID> <Product> [xQty]`;
      let exampleHelp = `.${shortKey} 5123456789 60\n.${shortKey} 5123456789 60 x5`;
      if (requiredFields.length === 2) {
        formatHelp = `.${shortKey} <${requiredFields[0].title || 'UID'}> <${requiredFields[1].title || 'ZoneID'}> <Product> [xQty]`;
        exampleHelp = `.${shortKey} 12345678 2001 86\n.${shortKey} 12345678 2001 86 x3`;
      }
      return ctx.reply(
        `⚡ *${gameName} Quick Top-Up Command*\n\n` +
        `📌 *Format:* \`${formatHelp}\`\n` +
        `💡 *Example:* \`${exampleHelp}\`\n\n` +
        `To view all packages & prices, send: \`.${shortKey}\``,
        { parse_mode: 'Markdown' }
      );
    }

    const extraInfo: Record<string, string> = {};
    if (requiredFields.length === 0) {
      extraInfo['uid'] = args[0];
    } else {
      for (let i = 0; i < requiredFields.length; i++) {
        const field = requiredFields[i];
        extraInfo[field.name] = args[i];
      }
    }

    if (args.length === minFields) {
      ctx.session = {};
      ctx.session.provider = 'lootbar';
      ctx.session.gameId = gameId;
      ctx.session.gameName = gameName;
      ctx.session.extraInfo = extraInfo;
      ctx.session.skus = skus;

      const buttons = skus.map((sku: any, idx: number) => {
        const name = sku.sku_name || 'Unknown Item';
        const price = sku.reseller_price || sku.price ? ` ($${sku.reseller_price || sku.price})` : '';
        return [Markup.button.callback(`${name}${price}`, `lb_s_${idx}`)];
      });
      buttons.push([Markup.button.callback('❌ Cancel', 'cancel_order')]);

      let infoDesc = Object.entries(extraInfo).map(([k, v]) => `• ${k.toUpperCase()}: \`${v}\``).join('\n');

      return ctx.reply(
        `🎮 *${gameName}*\n${infoDesc}\n\n` +
        `👇 ဝယ်ယူလိုသော Package ကို အောက်ပါ Button များမှ ရွေးချယ်နှိပ်ပါ:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons)
        }
      );
    }

    const rawProductQuery = args.slice(minFields).join(' ').trim();

    let skuKeys = {};
    if (game.skuShortKeys) {
      skuKeys = typeof game.skuShortKeys.get === 'function' 
        ? Object.fromEntries(game.skuShortKeys) 
        : game.skuShortKeys;
    }
    
    const parsedResult = parseSkuWithQuantity(skus, rawProductQuery, skuKeys, false);
    const matchedSku = parsedResult.sku;
    const quantity = parsedResult.quantity;

    ctx.session = {};
    ctx.session.quantity = quantity;
    ctx.session.provider = 'lootbar';
    ctx.session.gameId = gameId;
    ctx.session.gameName = gameName;
    ctx.session.extraInfo = extraInfo;
    ctx.session.skus = skus;

    if (!matchedSku) {
      const buttons = skus.map((sku: any, idx: number) => {
        const name = sku.sku_name || 'Unknown Item';
        const price = sku.reseller_price || sku.price ? ` ($${sku.reseller_price || sku.price})` : '';
        return [Markup.button.callback(`${name}${price}`, `lb_s_${idx}`)];
      });
      buttons.push([Markup.button.callback('❌ Cancel', 'cancel_order')]);

      let infoDesc = Object.entries(extraInfo).map(([k, v]) => `• ${k.toUpperCase()}: \`${v}\``).join('\n');

      let promptMsg = `⚠️ Package matching \`${rawProductQuery}\` not found.\n\n`;
      if (!rawProductQuery) promptMsg = '';
      return ctx.reply(
        promptMsg +
        `🎮 *${gameName}*\n${infoDesc}\n\n` +
        `👇 ဝယ်ယူလိုသော Package ကို အောက်ပါ Button များမှ ရွေးချယ်နှိပ်ပါ:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons)
        }
      );
    }

    ctx.session.skuId = String(matchedSku.sku_id);
    ctx.session.skuName = matchedSku.sku_name || `${gameName} Item`;
    ctx.session.skuPrice = parseFloat(matchedSku.reseller_price || matchedSku.price || '0');

    await showOrderConfirmation(ctx);

  } catch (err: any) {
    console.error('Direct order error:', err);
    return ctx.reply(`❌ Error processing order: ${err.message}`);
  }
}

export async function getLootBarLiveBalance(lootbar: LootBarClient): Promise<{ success: boolean; balance: string; error?: string }> {
  try {
    if (!lootbar.isConfigured()) {
      return { success: false, balance: '0.00', error: 'LootBar API credentials not configured.' };
    }
    const data = await lootbar.queryAsset();
    const bal = data?.data?.balance || (data as any)?.data?.money || (data as any)?.balance || '0.00';
    return { success: true, balance: Number(bal).toFixed(2) };
  } catch (err: any) {
    return { success: false, balance: '0.00', error: err.message || 'Failed to fetch LootBar balance' };
  }
}

export function registerLootBarHandlers(
  bot: Telegraf<MyContext>,
  lootbar: LootBarClient,
  askNextRequiredField?: (ctx: MyContext) => Promise<any>,
  showOrderConfirmation?: (ctx: MyContext) => Promise<any>
) {
  // LootBar catalog command
  bot.command(['lootbar', 'lb'], async (ctx) => {
    return await renderLootBarGameList(ctx, lootbar);
  });

  bot.hears(['🎮 LootBar Games', 'LootBar Games', 'Lootbar Games', 'LootBar', 'lootbar'], async (ctx) => {
    return await renderLootBarGameList(ctx, lootbar);
  });

  // Action: Select SKU from 1-Click Button (LootBar)
  bot.action(/^lb_s_(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const idx = parseInt(ctx.match[1], 10);
      const skus = ctx.session.skus || [];
      const selected = skus[idx];

      if (!selected) {
        return ctx.reply('⚠️ Package not found or session expired. Please re-enter the command.');
      }

      ctx.session.provider = 'lootbar';
      ctx.session.skuId = String(selected.sku_id);
      ctx.session.skuName = selected.sku_name || `${ctx.session.gameName} Package`;
      ctx.session.skuPrice = parseFloat(selected.reseller_price || selected.price || '0');

      if (showOrderConfirmation) {
        await showOrderConfirmation(ctx);
      }
    } catch (err: any) {
      console.error('Error handling LootBar package button click:', err);
      return ctx.reply(`❌ Error selecting package: ${err.message}`);
    }
  });

  // Action: Quick 1-click order from SKU listing (LootBar)
  bot.action(/^q_order_(.+?)_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const gameId = ctx.match[1];
      const skuId = ctx.match[2];

      const game = await SavedGame.findOne({ gameId });
      const gameName = game?.name || 'Game';

      const skuRes = await lootbar.getSkus(gameId);
      const skus = skuRes?.data?.items || [];
      const selectedSku = skus.find((s: any) => String(s.sku_id) === String(skuId));

      if (!selectedSku) {
        return ctx.reply('⚠️ Selected SKU not found.');
      }

      ctx.session = {};
      ctx.session.provider = 'lootbar';
      ctx.session.gameId = gameId;
      ctx.session.gameName = gameName;
      ctx.session.skuId = String(selectedSku.sku_id);
      ctx.session.skuName = selectedSku.sku_name || `${gameName} Package`;
      ctx.session.skuPrice = parseFloat(selectedSku.reseller_price || selectedSku.price || '0');
      ctx.session.requiredFields = selectedSku.extra_info || [];
      ctx.session.currentFieldIndex = 0;
      ctx.session.extraInfo = {};

      if (askNextRequiredField) {
        await askNextRequiredField(ctx);
      }
    } catch (err: any) {
      console.error('Error starting quick order from SKU listing:', err);
      return ctx.reply(`❌ Error starting order: ${err.message}`);
    }
  });

  // Action: Select Game from Catalog (LootBar)
  bot.action(/^game_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const gameId = ctx.match[1];
      ctx.session = { gameId };
      ctx.session.provider = 'lootbar';

      const game = await SavedGame.findOne({ gameId });
      if (game) {
        ctx.session.gameName = game.name;
      }

      const res = await lootbar.getSkus(gameId);
      const skus = res?.data?.items || [];
      ctx.session.skus = skus;

      if (skus.length === 0) {
        return ctx.reply('No packages available for this game.');
      }

      const buttons = skus.map((sku: any) => [
        Markup.button.callback(`${sku.sku_name} - $${sku.reseller_price || sku.price}`, `sku_${sku.sku_id}`)
      ]);
      buttons.push([Markup.button.callback('⬅️ Back to Games', 'back_to_games')]);

      return ctx.reply(
        `🎮 *${ctx.session.gameName || 'Game'} Packages*\n\nSelect a package:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons)
        }
      );
    } catch (err: any) {
      return ctx.reply(`Error: ${err.message}`);
    }
  });

  // Action: Select SKU (LootBar)
  bot.action(/^sku_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const skuId = ctx.match[1];
      const selected = (ctx.session.skus || []).find((s: any) => String(s.sku_id) === String(skuId));
      if (!selected) return ctx.reply('Selected package not found.');

      ctx.session.provider = 'lootbar';
      ctx.session.skuId = String(skuId);
      ctx.session.skuName = selected.sku_name;
      ctx.session.skuPrice = parseFloat(selected.reseller_price || selected.price || '0');

      ctx.session.requiredFields = selected.extra_info || [];
      ctx.session.currentFieldIndex = 0;
      ctx.session.extraInfo = {};

      await askNextRequiredField(ctx);
    } catch (err: any) {
      return ctx.reply(`Error: ${err.message}`);
    }
  });
}
