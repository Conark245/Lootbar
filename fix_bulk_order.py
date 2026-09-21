with open('server/bulkOrderService.ts', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace("import { LootBarClient } from './lootbar';", "import { LootBarClient } from './providers/lootbar/LootBarClient';")
code = code.replace("provider: 'lootbar' | 'topupnation' | 'fzrcards';", "provider: 'lootbar' | 'topupnation' | 'fzrcards' | 'g2bulk';")

with open('server/bulkOrderService.ts', 'w', encoding='utf-8') as f:
    f.write(code)
