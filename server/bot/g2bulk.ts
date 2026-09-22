import { Telegraf, Markup } from 'telegraf';
import { G2BulkService } from '../providers/g2bulk/G2BulkService';
import { G2BulkProduct } from '../models/G2BulkProduct';
import { MyContext } from './types';
import { parseSkuWithQuantity } from './matching';

export async function renderG2BulkGameList(ctx: MyContext, g2bulk?: G2BulkService) {
  try {
    let products = await G2BulkProduct.find({
      isEnabled: { $ne: false },
      status: { $ne: 'DISABLED' }
    }).sort({ name: 1 }).lean();

    if ((!products || products.length === 0) && g2bulk) {
      try {
        await g2bulk.getProducts();
        products = await G2BulkProduct.find({
          isEnabled: { $ne: false },
          status: { $ne: 'DISABLED' }
        }).sort({ name: 1 }).lean();
      } catch (err) {
        console.warn('Auto sync G2Bulk products failed:', err);
      }
    }

    if (!products || products.length === 0) {
      return ctx.reply('⚠️ No G2Bulk products are currently available or enabled. Please sync products in Admin Dashboard.');
    }

    let msg = `🔥 *G2Bulk API — ရရှိနိုင်သော Games & Gift Cards စာရင်း*\n\n` +
      `အောက်ပါ Product များအား G2Bulk မှတစ်ဆင့် Top-Up / Gift Card ဝယ်ယူနိုင်ပါသည်:\n\n`;

    const numEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

    products.forEach((p: any, index: number) => {
      const shortKey = (p.shortKey || `g${p.productId.slice(0, 4)}`).toLowerCase();
      const numEmoji = numEmojis[index] || `🔹`;
      const catBadge = p.category ? ` [${p.category}]` : '';

      const requiredFields = (p.fields || []).filter((f: any) => f.required);
      let format = `.${shortKey} <PlayerID> <Product>`;
      let example = `.${shortKey} 123456789 100`;

      if (requiredFields.length === 1) {
        const fName = requiredFields[0].title || requiredFields[0].name || 'PlayerID';
        format = `.${shortKey} <${fName}> <Product>`;
        example = `.${shortKey} 12345678 100`;
      } else if (requiredFields.length >= 2) {
        const f1 = requiredFields[0].title || requiredFields[0].name || 'Account';
        const f2 = requiredFields[1].title || requiredFields[1].name || 'Server';
        format = `.${shortKey} <${f1}> <${f2}> <Product>`;
        example = `.${shortKey} 12345678 2001 100`;
      }

      msg += `${numEmoji} *${p.name}*${catBadge}\n` +
        `   ▫️ *Short Key:* \`.${shortKey}\`\n` +
        `   ▫️ *Packages ကြည့်ရန်:* \`.${shortKey}\`\n` +
        `   ▫️ *Order တင်ရန်:* \`${format}\`\n` +
        `   ▫️ *ဥပမာ:* \`${example}\`\n\n`;
    });

    msg += `━━━━━━━━━━━━━━━━━━━━\n` +
      `💡 *အသုံးပြုနည်း လမ်းညွှန်:*\n` +
      `• Packages & Prices ကြည့်ရှုရန်: \`.<shortKey>\` (ဥပမာ \`.${products[0]?.shortKey || 'g2b'}\`)\n` +
      `• တိုက်ရိုက် Order တင်ရန်: \`.<shortKey> <Account> <Product>\``;

    return ctx.reply(msg, { parse_mode: 'Markdown' });
  } catch (error: any) {
    console.error('Failed to fetch G2Bulk text game list:', error);
    return ctx.reply(`An error occurred while fetching the G2Bulk game list: ${error.message}`);
  }
}

export async function handleG2BulkPackageList(ctx: MyContext, product: any, shortKey: string) {
  try {
    const productName = product.name || 'Game';
    const skus = (product.skus || []).filter((s: any) => s.available !== false);

    if (!skus || skus.length === 0) {
      return ctx.reply(`⚠️ No packages available for *${productName}* from G2Bulk.`, { parse_mode: 'Markdown' });
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

    let msg = `🔥 *${productName} (G2Bulk) — Packages & Prices*\n\n` +
      `📦 *ရရှိနိုင်သော Products စာရင်း:*\n`;

    skus.forEach((sku: any) => {
      const name = sku.name || `Package #${sku.sku}`;
      const price = sku.price || '0.00';
      const customKey = skuKeys[String(sku.sku)];
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
    console.error('Error fetching G2Bulk package list:', err);
    return ctx.reply(`❌ Error fetching package list: ${err.message}`);
  }
}

export async function handleG2BulkDirectOrder(
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
      let formatHelp = `.${shortKey} <Account> <Package>`;
      let exampleHelp = `.${shortKey} 123456789 100`;
      if (requiredFields.length === 2) {
        formatHelp = `.${shortKey} <${requiredFields[0].title || 'Account'}> <${requiredFields[1].title || 'Server'}> <Package>`;
        exampleHelp = `.${shortKey} 12345678 2001 100`;
      }
      return ctx.reply(
        `🔥 *${productName} (G2Bulk) Quick Order*\n\n` +
        `📌 *Format:* \`${formatHelp}\`\n` +
        `💡 *Example:* \`${exampleHelp}\`\n\n` +
        `To view all packages & prices, send: \`.${shortKey}\``,
        { parse_mode: 'Markdown' }
      );
    }

    // Parse fields — G2Bulk products use player_id / server_id
    const extraInfo: Record<string, any> = {};
    if (requiredFields.length === 0) {
      extraInfo['player_id'] = args[0];
    } else {
      for (let i = 0; i < requiredFields.length; i++) {
        extraInfo[requiredFields[i].name] = args[i];
      }
      if (!extraInfo['player_id'] && args[0]) {
        extraInfo['player_id'] = args[0];
      }
    }

    if (args.length === minFields) {
      ctx.session = {};
      ctx.session.provider = 'g2bulk';
      ctx.session.gameId = productId;
      ctx.session.gameName = productName;
      ctx.session.extraInfo = extraInfo;
      ctx.session.skus = skus;

      const buttons = skus.map((sku: any, idx: number) => {
        const name = sku.name || 'Unknown Item';
        const price = sku.price ? ` ($${sku.price})` : '';
        return [Markup.button.callback(`${name}${price}`, `g2b_s_${idx}`)];
      });
      buttons.push([Markup.button.callback('❌ Cancel', 'cancel_order')]);

      let infoDesc = Object.entries(extraInfo).map(([k, v]) => `• ${k.toUpperCase()}: \`${v}\``).join('\n');

      return ctx.reply(
        `🔥 *${productName} (G2Bulk)*\n${infoDesc}\n\n` +
        `👇 ဝယ်ယူလိုသော Package ကို အောက်ပါ Button များမှ ရွေးချယ်နှိပ်ပါ:`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
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

    ctx.session = {};
    ctx.session.quantity = 1; // G2Bulk API does not support quantity
    ctx.session.provider = 'g2bulk';
    ctx.session.gameId = productId;
    ctx.session.gameName = productName;
    ctx.session.extraInfo = extraInfo;
    ctx.session.skus = skus;

    if (!matchedSku) {
      const buttons = skus.map((sku: any, idx: number) => {
        const name = sku.name || 'Unknown Item';
        const price = sku.price ? ` ($${sku.price})` : '';
        return [Markup.button.callback(`${name}${price}`, `g2b_s_${idx}`)];
      });
      buttons.push([Markup.button.callback('❌ Cancel', 'cancel_order')]);

      let infoDesc = Object.entries(extraInfo).map(([k, v]) => `• ${k.toUpperCase()}: \`${v}\``).join('\n');
      let promptMsg = rawProductQuery ? `⚠️ Package matching \`${rawProductQuery}\` not found.\n\n` : '';

      return ctx.reply(
        promptMsg +
        `🔥 *${productName} (G2Bulk)*\n${infoDesc}\n\n` +
        `👇 ဝယ်ယူလိုသော Package ကို အောက်ပါ Button များမှ ရွေးချယ်နှိပ်ပါ:`,
        { parse_mode: 'Markdown', ...Markup.inlineKeyboard(buttons) }
      );
    }

    ctx.session.skuId = String(matchedSku.sku);
    ctx.session.skuName = matchedSku.name || `${productName} Package`;
    ctx.session.skuPrice = typeof matchedSku.price === 'number' ? matchedSku.price : parseFloat(String(matchedSku.price || '0'));

    await showOrderConfirmation(ctx);

  } catch (err: any) {
    console.error('G2Bulk direct order error:', err);
    return ctx.reply(`❌ Error processing order: ${err.message}`);
  }
}

export async function getG2BulkLiveBalance(g2bulk?: G2BulkService): Promise<{ success: boolean; balance: string; currency: string; error?: string }> {
  try {
    if (!g2bulk || !g2bulk.getClient()?.isConfigured()) {
      return { success: false, balance: '0.00', currency: 'USD', error: 'G2Bulk API credentials not configured.' };
    }
    const bal = await g2bulk.getClient().getBalance();
    return {
      success: true,
      balance: Number(bal || 0).toFixed(2),
      currency: 'USD'
    };
  } catch (err: any) {
    return { success: false, balance: '0.00', currency: 'USD', error: err.message || 'Failed to fetch G2Bulk balance' };
  }
}

export function registerG2BulkHandlers(
  bot: Telegraf<MyContext>,
  g2bulk?: G2BulkService,
  showOrderConfirmation?: (ctx: MyContext) => Promise<any>
) {
  bot.hears(['🔥 G2Bulk Games', 'G2Bulk Games', 'G2Bulk', 'g2bulk'], async (ctx) => {
    return await renderG2BulkGameList(ctx, g2bulk);
  });

  // Action: Select SKU from 1-Click Button (G2Bulk)
  bot.action(/^g2b_s_(\d+)$/, async (ctx) => {
    try {
      await ctx.answerCbQuery();
      const idx = parseInt(ctx.match[1], 10);
      const skus = ctx.session.skus || [];
      const selected = skus[idx];

      if (!selected) {
        return ctx.reply('⚠️ Package not found or session expired. Please re-enter the command.');
      }

      ctx.session.provider = 'g2bulk';
      ctx.session.skuId = String(selected.sku);
      ctx.session.skuName = selected.name || `${ctx.session.gameName} Package`;
      ctx.session.skuPrice = typeof selected.price === 'number' ? selected.price : parseFloat(String(selected.price || '0'));

      if (showOrderConfirmation) {
        await showOrderConfirmation(ctx);
      }
    } catch (err: any) {
      console.error('Error handling G2Bulk package button click:', err);
      return ctx.reply(`❌ Error selecting package: ${err.message}`);
    }
  });
}
