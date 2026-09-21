with open('server/bot.ts', 'r', encoding='utf-8') as f:
    code = f.read()

# Fix the stray "(shows both providers in text)" which caused syntax error
code = code.replace(" (shows both providers in text)", "// (shows both providers in text)")

with open('server/bot.ts', 'w', encoding='utf-8') as f:
    f.write(code)

