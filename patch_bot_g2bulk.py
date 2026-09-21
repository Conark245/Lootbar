import re
import sys

with open('server/bot.ts', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Remove findG2BulkSkuMatch
dead_code_pattern = r"async function findG2BulkSkuMatch\(shortKey: string\) \{.*?\n\}\n"
code = re.sub(dead_code_pattern, "", code, flags=re.DOTALL)

# 2. Add renderG2BulkGameList next to renderFzrCardsGameList
render_g2bulk = """
  async function renderG2BulkGameList(ctx: MyContext) {
    try {
      const products = await G2BulkProduct.find({
        isEnabled: { $ne: false },
        status: { $ne: 'DISABLED' }
      }).sort({ name: 1 });

      if (!products || products.length === 0) {
        return ctx.reply('⚠️ No G2Bulk games are currently enabled by the Owner. Please contact the administrator.');
      }

      let msg = `🔥 *G2Bulk API — ရရှိနိုင်သော Games စာရင်း*\\n\\n` +
        `အောက်ပါ Game များအား G2Bulk မှတစ်ဆင့် Top-Up ဝယ်ယူနိုင်ပါသည်။ Product စာရင်း ကြည့်ရှုရန် သို့မဟုတ် အော်ဒါတင်ရန် သက်ဆိုင်ရာ *Short Key* ဖြင့် အသုံးပြုနိုင်ပါသည်:\\n\\n`;

      const numEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

      products.forEach((p: any, index: number) => {
        const shortKey = (p.shortKey || `g${p.productId.slice(0, 4)}`).toLowerCase();
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

        msg += `${numEmoji} *${p.name}*\\n` +
          `   ▫️ *Short Key:* \\`.${shortKey}\\`\\n` +
          `   ▫️ *Packages ကြည့်ရန်:* \\`.${shortKey}\\`\\n` +
          `   ▫️ *Order တင်ရန်:* \\`${format}\\`\\n` +
          `   ▫️ *ဥပမာ:* \\`${example}\\`\\n\\n`;
      });

      msg += `━━━━━━━━━━━━━━━━━━━━\\n` +
        `💡 *အသုံးပြုနည်း လမ်းညွှန်:*\\n` +
        `• Packages & Prices ကြည့်ရှုရန်: \\`.<shortKey>\\` (ဥပမာ \\`.${products[0]?.shortKey || 'g2b'}\\`)\\n` +
        `• တိုက်ရိုက် Order တင်ရန်: \\`.<shortKey> <Account> <Product>\\``;

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (error: any) {
      console.error('Failed to fetch G2Bulk text game list:', error);
      return ctx.reply(`An error occurred while fetching the G2Bulk game list: ${error.message}`);
    }
  }

  // Combined or generic Game List handler
"""
code = code.replace("  // Combined or generic Game List handler", render_g2bulk)

# 3. Add handleG2BulkPackageList and handleG2BulkDirectOrder after FZR Cards equivalents
# We'll just look for the end of handleFzrCardsDirectOrder.
fzr_direct_order_end = """      // Directly proceed to confirmation
      await showOrderConfirmation(ctx);

    } catch (err: any) {
      console.error('FZR Cards direct order error:', err);
      return ctx.reply(`❌ Error processing order: ${err.message}`);
    }
  }
"""

g2bulk_handlers = """
  async function handleG2BulkPackageList(ctx: MyContext, product: any, shortKey: string) {
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

      let msg = `🔥 *${productName} (G2Bulk) — Packages & Prices*\\n\\n` +
        `📦 *ရရှိနိုင်သော Products စာရင်း:*\\n`;

      skus.forEach((sku: any) => {
        const name = sku.name || `Package #${sku.sku}`;
        const price = sku.price || '0.00';
        const customKey = skuKeys[String(sku.sku)];
        const shortKeyTag = customKey ? ` (Key: \\`${customKey}\\`)` : '';
        msg += `▫️ *${name}* — \\`$${Number(price).toFixed(3)} USD\\`${shortKeyTag}\\n`;
      });

      msg += `\\n━━━━━━━━━━━━━━━━━━━━\\n` +
        `🛒 *Order တင်ရန် Command Format:*\\n` +
        `\\`${orderFormatDesc}\\`\\n\\n` +
        `👉 *ဥပမာ:* \\`${exampleDesc}\\`\\n` +
        `━━━━━━━━━━━━━━━━━━━━`;

      return ctx.reply(msg, { parse_mode: 'Markdown' });
    } catch (err: any) {
      console.error('Error fetching G2Bulk package list:', err);
      return ctx.reply(`❌ Error fetching package list: ${err.message}`);
    }
  }

  async function handleG2BulkDirectOrder(ctx: MyContext, product: any, shortKey: string, args: string[]) {
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
          `🔥 *${productName} (G2Bulk) Quick Order*\\n\\n` +
          `📌 *Format:* \\`${formatHelp}\\`\\n` +
          `💡 *Example:* \\`${exampleHelp}\\`\\n\\n` +
          `To view all packages & prices, send: \\`.${shortKey}\\``,
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

        let infoDesc = Object.entries(extraInfo).map(([k, v]) => `• ${k.toUpperCase()}: \\`${v}\\``).join('\\n');

        return ctx.reply(
          `🔥 *${productName} (G2Bulk)*\\n${infoDesc}\\n\\n` +
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

        let infoDesc = Object.entries(extraInfo).map(([k, v]) => `• ${k.toUpperCase()}: \\`${v}\\``).join('\\n');
        let promptMsg = rawProductQuery ? `⚠️ Package matching \\`${rawProductQuery}\\` not found.\\n\\n` : '';

        return ctx.reply(
          promptMsg +
          `🔥 *${productName} (G2Bulk)*\\n${infoDesc}\\n\\n` +
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
"""
code = code.replace(fzr_direct_order_end, fzr_direct_order_end + "\n" + g2bulk_handlers)

# 4. Add G2Bulk block to bot.hears shortkey dispatcher
fzr_block_end = """
        if (matchedFzr) {
          if (matchedFzr.isEnabled === false || matchedFzr.status === 'DISABLED') {
            return ctx.reply(`⚠️ *${matchedFzr.name}* is currently disabled by Admin.`, { parse_mode: 'Markdown' });
          }

          const activeShortKey = (matchedFzr.shortKey || inputKey).toLowerCase();
          if (rawArgs.length === 0) {
            return await handleFzrCardsPackageList(ctx, matchedFzr, activeShortKey);
          } else {
            return await handleFzrCardsDirectOrder(ctx, matchedFzr, activeShortKey, rawArgs);
          }
        }

        return next(); // Not an enabled game short key, pass along
"""

g2bulk_block = """
        if (matchedFzr) {
          if (matchedFzr.isEnabled === false || matchedFzr.status === 'DISABLED') {
            return ctx.reply(`⚠️ *${matchedFzr.name}* is currently disabled by Admin.`, { parse_mode: 'Markdown' });
          }

          const activeShortKey = (matchedFzr.shortKey || inputKey).toLowerCase();
          if (rawArgs.length === 0) {
            return await handleFzrCardsPackageList(ctx, matchedFzr, activeShortKey);
          } else {
            return await handleFzrCardsDirectOrder(ctx, matchedFzr, activeShortKey, rawArgs);
          }
        }

        // Try matching G2Bulk products by shortKey
        const g2bProducts = await G2BulkProduct.find({ isEnabled: { $ne: false } });
        const matchedG2b = g2bProducts.find((p: any) => {
          const k = (p.shortKey || '').toLowerCase();
          return k === inputKey || String(p.productId).toLowerCase() === inputKey;
        });

        if (matchedG2b) {
          if (matchedG2b.isEnabled === false || matchedG2b.status === 'DISABLED') {
            return ctx.reply(`⚠️ *${matchedG2b.name}* is currently disabled by Admin.`, { parse_mode: 'Markdown' });
          }

          const activeShortKey = (matchedG2b.shortKey || inputKey).toLowerCase();
          if (rawArgs.length === 0) {
            return await handleG2BulkPackageList(ctx, matchedG2b, activeShortKey);
          } else {
            return await handleG2BulkDirectOrder(ctx, matchedG2b, activeShortKey, rawArgs);
          }
        }

        return next(); // Not an enabled game short key, pass along
"""
code = code.replace(fzr_block_end, g2bulk_block)

# 5. Fix finalizeOrder G2Bulk branch
broken_g2bulk_branch = """
          if (isG2Bulk && g2bulk) {
            const result = await g2bulk.placeOrder(
              ctx.session.userAccount!,
              user._id.toString(),
              ctx.session.productId!,
              ctx.session.skuId!,
              ctx.session.dynamicFields || {},
              ctx.chat!.id
            );
"""
fixed_g2bulk_branch = """
          if (isG2Bulk && g2bulk) {
            const primaryAccountValue = String(
              ctx.session.extraInfo?.player_id ?? Object.values(ctx.session.extraInfo || {})[0] ?? ''
            );
            const result = await g2bulk.placeOrder(
              primaryAccountValue,
              userDoc._id.toString(),
              ctx.session.gameId!,
              ctx.session.skuId!,
              ctx.session.extraInfo || {},
              ctx.chat!.id
            );
"""
code = code.replace(broken_g2bulk_branch, fixed_g2bulk_branch)

# 6. Add "🔥 G2Bulk Games" to mainMenu
old_menu = """
  const mainMenu = Markup.keyboard([
    ['🎮 All Games', '📦 Bulk Order'],
    ['🎮 LootBar Games', '🌐 TopupNation Games'],
    ['💎 FZR Cards Games', '💰 Request Top-Up'],
    ['📜 Order History', '💳 Check Balance'],
    ['👤 My Account']
  ]).resize();
"""
new_menu = """
  const mainMenu = Markup.keyboard([
    ['🎮 All Games', '📦 Bulk Order'],
    ['🎮 LootBar Games', '🌐 TopupNation Games'],
    ['💎 FZR Cards Games', '🔥 G2Bulk Games'],
    ['💰 Request Top-Up', '📜 Order History'],
    ['💳 Check Balance', '👤 My Account']
  ]).resize();
"""
code = code.replace(old_menu, new_menu)

# 7. Add bot.hears for G2Bulk Games menu
fzr_hears = """
  bot.hears(['💎 FZR Cards Games', 'FZR Cards Games', 'FZR Cards', 'fzrcards'], async (ctx) => {
    return await renderFzrCardsGameList(ctx);
  });
"""
g2bulk_hears = """
  bot.hears(['💎 FZR Cards Games', 'FZR Cards Games', 'FZR Cards', 'fzrcards'], async (ctx) => {
    return await renderFzrCardsGameList(ctx);
  });

  bot.hears(['🔥 G2Bulk Games', 'G2Bulk Games', 'G2Bulk', 'g2bulk'], async (ctx) => {
    return await renderG2BulkGameList(ctx);
  });
"""
code = code.replace(fzr_hears, g2bulk_hears)

# 8. Add g2b_s_ button callback
fzr_action = """
  bot.action(/^fzr_s_(\\d+)$/, async (ctx) => {
    const idx = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    try {
      const skus = ctx.session.skus || [];
      const sku = skus[idx];
      if (!sku) {
        return ctx.reply('⚠️ Session expired. Please type the command again.');
      }
      ctx.session.provider = 'fzrcards';
      ctx.session.skuId = String(sku.sku);
      ctx.session.skuName = sku.name || 'Package';
      ctx.session.skuPrice = typeof sku.price === 'number' ? sku.price : parseFloat(String(sku.price || '0'));
      await showOrderConfirmation(ctx);
    } catch (err: any) {
      return ctx.reply(`❌ Error: ${err.message}`);
    }
  });
"""
g2bulk_action = """
  bot.action(/^fzr_s_(\\d+)$/, async (ctx) => {
    const idx = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    try {
      const skus = ctx.session.skus || [];
      const sku = skus[idx];
      if (!sku) {
        return ctx.reply('⚠️ Session expired. Please type the command again.');
      }
      ctx.session.provider = 'fzrcards';
      ctx.session.skuId = String(sku.sku);
      ctx.session.skuName = sku.name || 'Package';
      ctx.session.skuPrice = typeof sku.price === 'number' ? sku.price : parseFloat(String(sku.price || '0'));
      await showOrderConfirmation(ctx);
    } catch (err: any) {
      return ctx.reply(`❌ Error: ${err.message}`);
    }
  });

  bot.action(/^g2b_s_(\\d+)$/, async (ctx) => {
    const idx = parseInt(ctx.match[1], 10);
    await ctx.answerCbQuery();
    try {
      const skus = ctx.session.skus || [];
      const sku = skus[idx];
      if (!sku) {
        return ctx.reply('⚠️ Session expired. Please type the command again.');
      }
      ctx.session.provider = 'g2bulk';
      ctx.session.skuId = String(sku.sku);
      ctx.session.skuName = sku.name || 'Package';
      ctx.session.skuPrice = typeof sku.price === 'number' ? sku.price : parseFloat(String(sku.price || '0'));
      await showOrderConfirmation(ctx);
    } catch (err: any) {
      return ctx.reply(`❌ Error: ${err.message}`);
    }
  });
"""
code = code.replace(fzr_action, g2bulk_action)

# Add "🔥 G2Bulk Games" to /help text block
old_help = """
      '• *🎮 LootBar Games* — LootBar API Games စာရင်း\\n' +
      '• *🌐 TopupNation Games* — TopupNation API Games စာရင်း\\n' +
      '• *💎 FZR Cards Games* — FZR Cards API Games စာရင်း\\n' +
      '• *📦 Bulk Order* — အော်ဒါများစွာ တစ်ခါတည်း ဝယ်ယူခြင်း\\n\\n' +
"""
new_help = """
      '• *🎮 LootBar Games* — LootBar API Games စာရင်း\\n' +
      '• *🌐 TopupNation Games* — TopupNation API Games စာရင်း\\n' +
      '• *💎 FZR Cards Games* — FZR Cards API Games စာရင်း\\n' +
      '• *🔥 G2Bulk Games* — G2Bulk API Games စာရင်း\\n' +
      '• *📦 Bulk Order* — အော်ဒါများစွာ တစ်ခါတည်း ဝယ်ယူခြင်း\\n\\n' +
"""
code = code.replace(old_help, new_help)

with open('server/bot.ts', 'w', encoding='utf-8') as f:
    f.write(code)

