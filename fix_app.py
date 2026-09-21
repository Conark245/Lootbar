with open('src/App_v2.tsx', 'r', encoding='utf-8') as f:
    code = f.read()

code = code.replace("setShowSkuModal(false);", "setSkuModalGame(null);")

with open('src/App_v2.tsx', 'w', encoding='utf-8') as f:
    f.write(code)
