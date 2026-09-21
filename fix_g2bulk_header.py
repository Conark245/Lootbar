import re

with open('src/App_v2.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_fzr_button = """              <button 
                onClick={() => setShowFzrModal(true)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 ${
                  fzrConfigured 
                    ? 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100' 
                    : 'bg-neutral-100 text-neutral-700 border-neutral-200 hover:bg-neutral-200'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${fzrConfigured ? 'bg-sky-500' : 'bg-neutral-400'}`}></span>
                FZR Cards API: {fzrConfigured ? 'Connected' : 'Setup'}
              </button>"""

new_buttons = """              <button 
                onClick={() => setShowFzrModal(true)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 ${
                  fzrConfigured 
                    ? 'bg-sky-50 text-sky-700 border-sky-200 hover:bg-sky-100' 
                    : 'bg-neutral-100 text-neutral-700 border-neutral-200 hover:bg-neutral-200'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${fzrConfigured ? 'bg-sky-500' : 'bg-neutral-400'}`}></span>
                FZR Cards API: {fzrConfigured ? 'Connected' : 'Setup'}
              </button>
              <button 
                onClick={() => setShowG2BulkSettings(true)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 ${
                  g2bulkConfigured 
                    ? 'bg-orange-50 text-orange-700 border-orange-200 hover:bg-orange-100' 
                    : 'bg-neutral-100 text-neutral-700 border-neutral-200 hover:bg-neutral-200'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${g2bulkConfigured ? 'bg-orange-500' : 'bg-neutral-400'}`}></span>
                G2Bulk API: {g2bulkConfigured ? 'Connected' : 'Setup'}
              </button>"""

content = content.replace(old_fzr_button, new_buttons)

with open('src/App_v2.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
