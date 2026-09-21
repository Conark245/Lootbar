with open('server/providers/lootbar/types.ts', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace("  name: string;", "  name: string;\n  game_name?: string;")

with open('server/providers/lootbar/types.ts', 'w', encoding='utf-8') as f:
    f.write(code)
