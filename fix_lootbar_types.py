with open('server/providers/lootbar/types.ts', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace("list: LootBarGame[];", "items: LootBarGame[];")
code = code.replace("list: LootBarSku[];", "items: LootBarSku[];")

code = code.replace("export interface LootBarOrderResponse {\n  status?: string;\n  msg?: string;\n  data?: {", 
"export interface LootBarOrderResponse {\n  status?: string;\n  msg?: string;\n  message?: string;\n  error?: string;\n  data?: {")

with open('server/providers/lootbar/types.ts', 'w', encoding='utf-8') as f:
    f.write(code)
