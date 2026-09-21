import re

with open('server.ts', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace('import { LootBarClient } from "./server/lootbar";', 'import { LootBarClient } from "./server/providers/lootbar/LootBarClient";')

with open('server.ts', 'w', encoding='utf-8') as f:
    f.write(code)
