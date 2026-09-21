import re

with open('src/App_v2.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace("Authorize bot users, link selected resellers directly to live API balance, and manage wallet credits", "Authorize bot users and manage wallet credits")

with open('src/App_v2.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
