with open('src/App_v2.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace("const openSkuModal = async (game: any, provider: 'lootbar' | 'topupnation' | 'fzrcards' | boolean) => {", "const openSkuModal = async (game: any, provider: 'lootbar' | 'topupnation' | 'fzrcards' | 'g2bulk' | boolean) => {")
code = code.replace("openSkuModal(p, false, false, true)", "openSkuModal(p, 'g2bulk')")

with open('src/App_v2.tsx', 'w', encoding='utf-8') as f:
    f.write(code)
