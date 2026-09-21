import re

# Fix BulkOrderBatch model
with open('server/models/BulkOrderBatch.ts', 'r', encoding='utf-8') as f:
    batch_code = f.read()

batch_code = batch_code.replace("provider: 'lootbar' | 'topupnation' | 'fzrcards';", "provider: 'lootbar' | 'topupnation' | 'fzrcards' | 'g2bulk';")
batch_code = batch_code.replace("enum: ['lootbar', 'topupnation', 'fzrcards']", "enum: ['lootbar', 'topupnation', 'fzrcards', 'g2bulk']")

with open('server/models/BulkOrderBatch.ts', 'w', encoding='utf-8') as f:
    f.write(batch_code)


# Fix G2BulkService
with open('server/providers/g2bulk/G2BulkService.ts', 'r', encoding='utf-8') as f:
    g2bulk_code = f.read()

g2bulk_code = g2bulk_code.replace("user.totalSpent = (user.totalSpent || 0) + totalCost;", "")

with open('server/providers/g2bulk/G2BulkService.ts', 'w', encoding='utf-8') as f:
    f.write(g2bulk_code)
