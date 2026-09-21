import re

with open('src/App_v2.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('<div className="flex flex-wrap items-center gap-2.5">\n              <button\n                onClick={() => fetchOrders()}', '</div>\n\n            <div className="flex flex-wrap items-center gap-2.5">\n              <button\n                onClick={() => fetchOrders()}')

with open('src/App_v2.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
