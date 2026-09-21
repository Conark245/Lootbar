import re

with open('src/App_v2.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

content = content.replace('            </div>\n                        </div>\n          </div>\n        </div>\n\n        {/* TopupNation Products Management */}', '            </div>\n          </div>\n        </div>\n\n        {/* TopupNation Products Management */}')

with open('src/App_v2.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
