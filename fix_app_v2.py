import re

with open('src/App_v2.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# 1. Remove the balance cards (LootBar, TopupNation, G2Bulk, FZR Cards) from Owner Settings
content = re.sub(r'\{/\* LootBar Balance Card \*/\}.*?\{/\* TopupNation Products Management \*/\}', '{/* TopupNation Products Management */}', content, flags=re.DOTALL)

# 2. Remove LIVE API BALANCES IN ORDER HISTORY
content = re.sub(r'\{/\* LIVE API BALANCES IN ORDER HISTORY \*/\}.*?</div>\s*<div className="flex flex-wrap items-center gap-2\.5">', '<div className="flex flex-wrap items-center gap-2.5">', content, flags=re.DOTALL)

# 3. Remove "Live LootBar API Balance:" in the user management section
# (Search for the block near "Authorize bot users, link selected resellers directly to live API balance")
content = re.sub(r'\{lootbarBalance && \(\s*<div className="hidden sm:flex items-center gap-2 px-3 py-1\.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-medium text-emerald-800">\s*<span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>\s*<span>Live LootBar API Balance:</span>\s*<span className="font-bold font-mono text-emerald-900">\$\{lootbarBalance\.total_amount \|\| lootbarBalance\.balance \|\| \'0\.00\'\}</span>\s*</div>\s*\)\}', '', content, flags=re.DOTALL)

with open('src/App_v2.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
