import re

with open('src/App_v2.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

# Fix the button overlap in App_v2.tsx
old_button = """                <button
                  onClick={() => setOrderProviderFilter('FZRCARDS' as any)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${
                    (orderProviderFilter as string) === 'FZRCARDS'
                      ? 'bg-sky-700 text-white shadow-xs font-semibold'
                      : 'text-sky-700 hover:bg-sky-50'
                  }`}
                >
                  💎 FZR Cards ({orders.filter(o => o.provider === 'fzrcards' || o.extraInfo?.provider === 'fzrcards').length})
                  🔥 G2Bulk ({orders.filter(o => o.provider === 'g2bulk' || o.extraInfo?.provider === 'g2bulk').length})
                </button>"""

new_button = """                <button
                  onClick={() => setOrderProviderFilter('FZRCARDS' as any)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${
                    (orderProviderFilter as string) === 'FZRCARDS'
                      ? 'bg-sky-700 text-white shadow-xs font-semibold'
                      : 'text-sky-700 hover:bg-sky-50'
                  }`}
                >
                  💎 FZR Cards ({orders.filter(o => o.provider === 'fzrcards' || o.extraInfo?.provider === 'fzrcards').length})
                </button>
                <button
                  onClick={() => setOrderProviderFilter('G2BULK' as any)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${
                    (orderProviderFilter as string) === 'G2BULK'
                      ? 'bg-orange-700 text-white shadow-xs font-semibold'
                      : 'text-orange-700 hover:bg-orange-50'
                  }`}
                >
                  🔥 G2Bulk ({orders.filter(o => o.provider === 'g2bulk' || o.extraInfo?.provider === 'g2bulk').length})
                </button>"""

content = content.replace(old_button, new_button)

# Also fix the LootBar filter to exclude G2Bulk
old_lb_filter = "o.provider !== 'topupnation' && o.provider !== 'fzrcards' && o.extraInfo?.provider !== 'topupnation' && o.extraInfo?.provider !== 'fzrcards'"
new_lb_filter = "o.provider !== 'topupnation' && o.provider !== 'fzrcards' && o.provider !== 'g2bulk' && o.extraInfo?.provider !== 'topupnation' && o.extraInfo?.provider !== 'fzrcards' && o.extraInfo?.provider !== 'g2bulk'"
content = content.replace(old_lb_filter, new_lb_filter)

# For the Env usage, the user said: "Website မှာ G2Bulk API ကို Env ထဲကဟာ ယူသုံးပေး"
# This means we should probably hide the API Key input for G2Bulk and just use the env variable.
# Let's see how `g2bulkConfigured` is handled. Let's make `g2bulkKey` default to process.env in the UI? No, frontend doesn't have process.env for backend secrets.
# I'll just change the text in the G2Bulk Settings modal to say it's using the Env key if it's set.

with open('src/App_v2.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
