import re

with open('src/App_v2.tsx', 'r', encoding='utf-8') as f:
    content = f.read()

old_key_ui = """              <div>
                <label className="block text-sm font-semibold text-neutral-800 mb-1.5">G2Bulk API Key</label>
                <input
                  type="password"
                  value={g2bulkKey}
                  onChange={e => setG2BulkKey(e.target.value)}
                  className="w-full border-neutral-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-sm shadow-sm transition-all"
                  placeholder="Enter G2Bulk API Key..."
                />
              </div>"""

new_key_ui = """              <div>
                <label className="block text-sm font-semibold text-neutral-800 mb-1.5 flex items-center justify-between">
                  <span>G2Bulk API Key</span>
                  {g2bulkConfigured && !g2bulkKey && (
                     <span className="text-[10px] uppercase tracking-wide font-bold bg-green-100 text-green-800 px-2 py-0.5 rounded-full">Using Env Key</span>
                  )}
                </label>
                <input
                  type="password"
                  value={g2bulkKey}
                  onChange={e => setG2BulkKey(e.target.value)}
                  className="w-full border-neutral-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-sm shadow-sm transition-all"
                  placeholder={g2bulkConfigured ? "Leave blank to keep current/env key" : "Enter G2Bulk API Key..."}
                />
                <p className="text-xs text-neutral-500 mt-1">If set in server `.env`, you can leave this blank.</p>
              </div>"""

content = content.replace(old_key_ui, new_key_ui)

with open('src/App_v2.tsx', 'w', encoding='utf-8') as f:
    f.write(content)
