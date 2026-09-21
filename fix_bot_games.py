with open('server/bot.ts', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace("      games = response?.data?.items || [];", "      games = (response?.data?.items || []).map((g: any) => ({ game_id: String(g.game_id), game_name: g.name || g.game_name }));")

with open('server/bot.ts', 'w', encoding='utf-8') as f:
    f.write(code)
