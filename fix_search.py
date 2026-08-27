import re

with open('src/App_v2.tsx', 'r') as f:
    content = f.read()

def inject_search(content, provider_flag, state_name, placeholder, color):
    target = f'          {{{provider_flag} && (\n            <div className="mt-4">'
    replacement = f'''          {{{provider_flag} && (
            <div className="mt-4">
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="{placeholder}"
                  className="px-4 py-2 border border-neutral-300 rounded-lg w-full max-w-sm focus:outline-none focus:border-{color}-500 focus:ring-1 focus:ring-{color}-500"
                  value={{{state_name}}}
                  onChange={{(e) => {state_name.replace('GameSearch', '')}GameSearch(e.target.value)}}
                />
              </div>'''
    
    # replace first occurrence just in case
    return content.replace(target, replacement)


# Note: the set function for `lbGameSearch` is `setLbGameSearch`. Wait, my string replacement:
# `{state_name.replace('GameSearch', '')}GameSearch` - actually better to hardcode.

def apply(content, flag, var, setter, placeholder, color):
    target = f'          {{{flag} && (\n            <div className="mt-4">'
    replacement = f'''          {{{flag} && (
            <div className="mt-4">
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="{placeholder}"
                  className="px-4 py-2 border border-neutral-300 rounded-lg w-full max-w-sm focus:outline-none focus:border-{color}-500 focus:ring-1 focus:ring-{color}-500"
                  value={{{var}}}
                  onChange={{(e) => {setter}(e.target.value)}}
                />
              </div>'''
    return content.replace(target, replacement)

content = apply(content, 'showLootbarGames', 'lbGameSearch', 'setLbGameSearch', 'Search LootBar Games...', 'emerald')
content = apply(content, 'showTpnGames', 'tpnGameSearch', 'setTpnGameSearch', 'Search TopUpNation Games...', 'indigo')
content = apply(content, 'showFzrGames', 'fzrGameSearch', 'setFzrGameSearch', 'Search FZR Cards Games...', 'sky')

with open('src/App_v2.tsx', 'w') as f:
    f.write(content)

