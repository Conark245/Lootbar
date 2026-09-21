with open('server/bot.ts', 'r', encoding='utf-8') as f:
    code = f.read()

bad_g2bulk = """    if (isG2Bulk && g2bulk) {
      const result = await g2bulk.placeOrder(
        ctx.session.userAccount!,
        user._id.toString(),
        ctx.session.productId!,
        ctx.session.skuId!,
        ctx.session.dynamicFields || {},
        ctx.chat!.id
      );"""

good_g2bulk = """    if (isG2Bulk && g2bulk) {
      const result = await g2bulk.placeOrder(
        playerName || (extraInfo.player_id ? String(extraInfo.player_id) : 'Unknown'),
        userDoc._id.toString(),
        gameId,
        skuId,
        extraInfo,
        ctx.chat!.id
      );"""

code = code.replace(bad_g2bulk, good_g2bulk)

with open('server/bot.ts', 'w', encoding='utf-8') as f:
    f.write(code)
