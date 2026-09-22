import { Telegraf, Markup } from 'telegraf';
import { TopupNationService } from '../providers/topupnation/TopupNationService';
import { TopupNationProduct } from '../models/TopupNationProduct';
import { MyContext } from './types';
import { parseSkuWithQuantity } from './matching';

// Text-only Game List handler for TopupNation (No buttons, Owner-enabled only)
export async function renderTopupNationGameList(ctx: MyContext, topupNation?: TopupNationService) {
  try {
    const products = await TopupNationProduct.find({ 
      isEnabled: { $ne: false }, 
      status: { $ne: 'DISABLED' } 
    }).sort({ name: 1 });

    if (!products || products.length === 0) {
      return ctx.reply('⚠️ No TopupNation games are currently enabled by the Owner. Please contact the administrator.');
    }

    let msg = `🌐 *TopupNation API — ရရှိနိုင်သော Games စာရင်း*\n\n` +
      `အောက်ပါ Game များအား TopupNation မှတစ်ဆင့် Top-Up ဝယ်ယူနိုင်ပါသည်။ Product စာရင်း ကြည့်ရှုရန် သို့မဟုတ် အော်ဒါတင်ရန် သက်ဆိုင်ရာ *Short Key* ဖြင့် အသုံးပြုနိုင်ပါသည်:\n\n`;

    const numEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

    products.forEach((p: any, index: number) => {
      const shortKey = (p.shortKey || `t${p.productId.slice(0, 4)}`).toLowerCase();
      const numEmoji = numEmojis[index] || `🔹`;

      const requiredFields = (p.fields || []).filter((f: any) => f.required);
      let format = `.${shortKey} <PlayerID> <Product>`;
      let example = `.${shortKey} 123456789 60`;

      if (requiredFields.length === 1) {
        const fName = requiredFields[0].title || requiredFields[0].name || 'PlayerID';
        format = `.${shortKey} <${fName}> <Product>`;
        example = `.${shortKey} 12345678 60`;
      } else if (requiredFields.length >= 2) {
        const f1 = requiredFields[0].title || requiredFields[0].name || 'Account';
        const f2 = requiredFields[1].title || requiredFields[1].name || 'Server';
        format = `.${shortKey} <${f1}> <${f2}> <Product>`;
        example = `.${shortKey} 12345678 2001 86`;
      }

      msg += `${numEmoji} *${p.name}*\n` +
        `   ▫️ *Short Key:* \`.${shortKey}\`\n` +
        `   ▫️ *Packages ကြည့်ရန်:* \`.${shortKey}\`\n` +
        `   ▫️ *Order တင်ရန်:* \`${format}\`\n` +
        `   ▫️ *ဥပမာ:* \`${example}\`\n\n`;
    });

    msg += `━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 *အသုံးပြုနည်း လမ်းညွှန်:*\n` +
      `• Packages & Prices ကြည့်ရှုရန်: \`.<shortKey>\` (ဥပမာ \`.${products[0]?.shortKey || 'tp'}\`)\n` +
      `• တိုက်ရိုက် Order တင်ရန်: \`.<shortKey> <Account> <Product>\``;

    return ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error: any) {
    console.error('Failed to fetch TopupNation text game list:', error);
    return ctx.reply(`An error occurred while fetching the TopupNation game list: ${error.message}`);
  }
}

// Display packages & prices for TopupNation product
export async function handleTopupNationPackageList(ctx: MyContext, product: any, shortKey: string) {
  try {
    const productName = product.name || 'Game';
    const skus = (product.skus || []).filter((s: any) => s.available !== false && s.availability !== false);

    if (!skus || skus.length === 0) {
      return ctx.reply(`⚠️ No packages available for *${productName}* from TopupNation.`, { parse_mode: 'Markdown' });
    }

    const requiredFields = (product.fields || []).filter((f: any) => f.required);
    let orderFormatDesc = `.${shortKey} <PlayerID> <Package>`;
    let exampleDesc = `.${shortKey} 123456789 100`;

    if (requiredFields.length === 1) {
      const fName = requiredFields[0].title || requiredFields[0].name || 'PlayerID';
      orderFormatDesc = `.${shortKey} <${fName}> <Package>`;
      exampleDesc = `.${shortKey} 12345678 100`;
    } else if (requiredFields.length >= 2) {
      const f1 = requiredFields[0].title || requiredFields[0].name || 'UserAccount';
      const f2 = requiredFields[1].title || requiredFields[1].name || 'Server';
      orderFormatDesc = `.${shortKey} <${f1}> <${f2}> <Package>`;
      exampleDesc = `.${shortKey} 12345678 2001 100`;
    }

    let skuKeys: Record<string, string> = {};
    if (product.skuShortKeys) {
      skuKeys = typeof product.skuShortKeys.get === 'function' 
        ? Object.fromEntries(product.skuShortKeys) 
        : (product.skuShortKeys || {});
    }

    let msg = `🌐 *${productName} (TopupNation) — Packages & Prices*\n\n` +
      `📦 *ရရှိနိုင်သော Products စာရင်း:*\n`;

    skus.forEach((sku: any) => {
      const name = sku.name || `Package #${sku.sku}`;
      const price = sku.price || '0.00';
      const customKey = skuKeys[String(sku.sku || sku.sku_id)];
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
    console.error('Error fetching TopupNation package list:', err);
    return ctx.reply(`❌ Error fetching package list: ${err.message}`);
  }
}

// Direct order placement for TopupNation
export async function handleTopupNationDirectOrder(
  ctx: MyContext,
  product: any,
  shortKey: string,
  args: string[],
  showOrderConfirmation: (ctx: MyContext) => Promise<any>
) {
  try {
    const productId = String(product.productId);
    const productName = product.name || 'Game';
    const skus = product.skus || [];

    if (!skus || skus.length === 0) {
      return ctx.reply(`⚠️ No packages available for *${productName}*.`, { parse_mode: 'Markdown' });
    }

    const requiredFields = (product.fields || []).filter((f: any) => f.required);
    const minFields = requiredFields.length > 0 ? requiredFields.length : 1;

    if (args.length < minFields) {
      let formatHelp = `.${shortKey} <Account> <Package> [xQty]`;
      let exampleHelp = `.${shortKey} 123456789 100\n.${shortKey} 123456789 100 x2`;
      if (requiredFields.length === 2) {
        const f0 = requiredFields[0].title || requiredFields[0].label || requiredFields[0].name || requiredFields[0].key || 'Account';
        const f1 = requiredFields[1].title || requiredFields[1].label || requiredFields[1].name || requiredFields[1].key || 'Server';
        formatHelp = `.${shortKey} <${f0}> <${f1}> <Package> [xQty]`;
        exampleHelp = `.${shortKey} 12345678 2001 100\n.${shortKey} 12345678 2001 100 x3`;
      }
      return ctx.reply(
        `⚡ *${productName} (TopupNation) Quick Order*\n\n` +
        `📌 *Format:* \`${formatHelp}\`\n` +
        `💡 *Example:* \`${exampleHelp}\`\n\n` +
        `To view all packages & prices, send: \`.${shortKey}\``,
        { parse_mode: 'Markdown' }
      );
    }

    const extraInfo: Record<string, any> = {};
    if (requiredFields.length === 0) {
      extraInfo['userAccount'] = args[0];
      extraInfo['uid'] = args[0];
    } else {
      for (let i = 0; i < requiredFields.length; i++) {
        const field = requiredFields[i];
        const fieldKey = field?.name || field?.key || field?.field_name || field?.id;
        if (fieldKey && fieldKey !== 'undefined' && fieldKey !== 'null') {
          extraInfo[fieldKey] = args[i];
        }
      }
      if (!extraInfo['userAccount'] && args[0]) {
        extraInfo['userAccount'] = args[0];
      }
      if (!extraInfo['server'] && args[1] && requiredFields.length > 1) {
        extraInfo['server'] = args[1];
      }
      delete extraInfo['undefined'];
      delete extraInfo['null'];
    }

    if (args.length === minFields) {
      ctx.session = {};
      ctx.session.provider = 'topupnation';
      ctx.session.gameId = productId;
      ctx.session.gameName = productName;
      ctx.session.extraInfo = extraInfo;
      ctx.session.skus = skus;

      const buttons = skus.map((sku: any, idx: number) => {
        const name = sku.name || 'Unknown Item';
        const price = sku.price ? ` ($${sku.price})` : '';
        return [Markup.button.callback(`${name}${price}`, `tpn_s_${idx}`)];
      });
      buttons.push([Markup.button.callback('❌ Cancel', 'cancel_order')]);

      let infoDesc = Object.entries(extraInfo).map(([k, v]) => `• ${k.toUpperCase()}: \`${v}\``).join('\n');

      return ctx.reply(
        `🌐 *${productName} (TopupNation)*\n${infoDesc}\n\n` +
        `👇 ဝယ်ယူလိုသော Package ကို အောက်ပါ Button များမှ ရွေးချယ်နှိပ်ပါ:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons)
        }
      );
    }

    const rawProductQuery = args.slice(minFields).join(' ').trim();

    let skuKeys = {};
    if (product.skuShortKeys) {
      skuKeys = typeof product.skuShortKeys.get === 'function' 
        ? Object.fromEntries(product.skuShortKeys) 
        : product.skuShortKeys;
    }

    const parsedResult = parseSkuWithQuantity(skus, rawProductQuery, skuKeys, true);
    const matchedSku = parsedResult.sku;
    const quantity = parsedResult.quantity;

    ctx.session = {};
    ctx.session.quantity = quantity;
    ctx.session.provider = 'topupnation';
    ctx.session.gameId = productId;
    ctx.session.gameName = productName;
    ctx.session.extraInfo = extraInfo;
    ctx.session.skus = skus;

    if (!matchedSku) {
      const buttons = skus.map((sku: any, idx: number) => {
        const name = sku.name || 'Unknown Item';
        const price = sku.price ? ` ($${sku.price})` : '';
        return [Markup.button.callback(`${name}${price}`, `tpn_s_${idx}`)];
      });
      buttons.push([Markup.button.callback('❌ Cancel', 'cancel_order')]);

      let infoDesc = Object.entries(extraInfo).map(([k, v]) => `• ${k.toUpperCase()}: \`${v}\``).join('\n');

      let promptMsg = `⚠️ Package matching \`${rawProductQuery}\` not found.\n\n`;
      if (!rawProductQuery) promptMsg = '';
      return ctx.reply(
        promptMsg +
        `🌐 *${productName} (TopupNation)*\n${infoDesc}\n\n` +
        `👇 ဝယ်ယူလိုသော Package ကို အောက်ပါ Button များမှ ရွေးချယ်နှိပ်ပါ:`,
        {
          parse_mode: 'Markdown',
          ...Markup.inlineKeyboard(buttons)
        }
      );
    }

    ctx.session.skuId = String(matchedSku.sku);
    ctx.session.skuName = matchedSku.name || `${productName} Package`;
    ctx.session.skuPrice = typeof matchedSku.price === 'number' ? matchedSku.price : parseFloat(String(matchedSku.price || '0'));

    await showOrderConfirmation(ctx);

  } catch (err: any) {
    console.error('TopupNation direct order error:', err);
    return ctx.reply(`❌ Error processing order: ${err.message}`);
  }
}

export async function syncTopupNationProductLive(product: any, shortKey: string, topupNation?: TopupNationService): Promise<any> {
  try {
    if (!topupNation || !topupNation.getClient()?.isConfigured()) return product;
    const liveProducts = await topupNation.getClient().getProducts();
    if (!liveProducts || !Array.isArray(liveProducts)) return product;
    
    const liveMatch = liveProducts.find((lp: any) => String(lp.productId) === String(product.productId));
    if (liveMatch && liveMatch.skus && liveMatch.skus.length > 0) {
      product.skus = liveMatch.skus;
      product.fields = liveMatch.fields || product.fields;
      product.status = liveMatch.status || product.status;
      product.name = liveMatch.name || product.name;
      await TopupNationProduct.updateOne(
        { productId: product.productId },
        { 
          $set: { 
            skus: liveMatch.skus, 
            fields: liveMatch.fields || product.fields,
            status: liveMatch.status || product.status,
            name: liveMatch.name || product.name,
            lastSyncedAt: new Date() 
          } 
        }
      );
    }
  } catch (err) {
    console.warn(`[Live Sync Notice] Could not live sync TopupNation product ${shortKey}:`, err);
  }
  return product;
}

export async function getTopupNationLiveBalance(topupNation?: TopupNationService): Promise<{ success: boolean; balance: string; available: string; currency: string; error?: string }> {
  try {
    if (!topupNation || !topupNation.getClient()?.isConfigured()) {
      return { success: false, balance: '0.00', available: '0.00', currency: 'USD', error: 'TopupNation API credentials not configured.' };
    }
    const data = await topupNation.getWalletBalance();
    return {
      success: true,
      balance: Number(data.balance || 0).toFixed(2),
      available: Number(data.available || data.balance || 0).toFixed(2),
      currency: data.currency || 'USD'
    };
  } catch (err: any) {
    return { success: false, balance: '0.00', available: '0.00', currency: 'USD', error: err.message || 'Failed to fetch TopupNation balance' };
  }
}

export function registerTopupNationHandlers(
  bot: Telegraf<MyContext>,
  topupNation?: TopupNationService,
  showOrderConfirmation?: (ctx: MyContext) => Promise<any>,
  askNextRequiredField?: (ctx: MyContext) => Promise<any>
) {
  // TopupNation Games & Products Catalog Command
  bot.command(['tpn', 'topupnation'], async (ctx) => {
    return await renderTopupNationGameList(ctx, topupNation);
  });

  bot.hears(['🌐 TopupNation Games', 'TopupNation Games', 'TopUpNation Games', 'TopupNation', 'tpn'], async (ctx) => {
    return await renderTopupNationGameList(ctx, topupNation);
  });

  // Action: Select SKU from 1-Click Button (TopupNation)
  bot.action(/^tpn_s_(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const idx = parseInt(ctx.match[1], 10);
      const skus = ctx.session.skus || [];
      const selected = skus[idx];

      if (!selected) {
        return ctx.reply('⚠️ Package not found or session expired. Please re-enter the command.');
      }

      ctx.session.provider = 'topupnation';
      ctx.session.skuId = String(selected.sku);
      ctx.session.skuName = selected.name || `${ctx.session.gameName} Package`;
      ctx.session.skuPrice = typeof selected.price === 'number' ? selected.price : parseFloat(String(selected.price || '0'));

      if (showOrderConfirmation) {
        await showOrderConfirmation(ctx);
      }
    } catch (err: any) {
      console.error('Error handling TopupNation package button click:', err);
      return ctx.reply(`❌ Error selecting package: ${err.message}`);
    }
  });

  // Action: Quick 1-click order from SKU listing (TopupNation)
  bot.action(/^tpn_q_order_(.+?)_(.+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const productId = ctx.match[1];
      const skuId = ctx.match[2];

      const product = await TopupNationProduct.findOne({ productId });
      if (!product) {
        return ctx.reply('⚠️ TopupNation product not found.');
      }

      const skus = product.skus || [];
      const selectedSku = skus.find((s: any) => String(s.sku) === String(skuId));

      if (!selectedSku) {
        return ctx.reply('⚠️ Selected SKU not found in TopupNation catalog.');
      }

      ctx.session = {};
      ctx.session.provider = 'topupnation';
      ctx.session.gameId = productId;
      ctx.session.gameName = product.name || 'Game';
      ctx.session.skuId = String(selectedSku.sku);
      ctx.session.skuName = selectedSku.name || `${product.name} Package`;
      ctx.session.skuPrice = typeof selectedSku.price === 'number' ? selectedSku.price : parseFloat(String(selectedSku.price || '0'));
      ctx.session.requiredFields = (product.fields || []).filter((f: any) => f.required);
      ctx.session.currentFieldIndex = 0;
      ctx.session.extraInfo = {};

      if (askNextRequiredField) {
        await askNextRequiredField(ctx);
      }
    } catch (err: any) {
      console.error('Error starting quick order from TopupNation SKU listing:', err);
      return ctx.reply(`❌ Error starting order: ${err.message}`);
    }
  });
}
