const fs = require('fs');

let ui = fs.readFileSync('src/App_v2.tsx', 'utf8');

const targetSearchDiv = `
              <div className="mb-4">
                <input
                  type="text"
                  placeholder="Search TopUpNation Games..."
                  className="px-4 py-2 border border-neutral-300 rounded-lg w-full max-w-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  value={tpnGameSearch}
                  onChange={(e) => setTpnGameSearch(e.target.value)}
                />
              </div>
`;

const replaceSearchDiv = `
              <div className="mb-4 flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                <input
                  type="text"
                  placeholder="Search TopUpNation Games..."
                  className="px-4 py-2 border border-neutral-300 rounded-lg w-full max-w-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                  value={tpnGameSearch}
                  onChange={(e) => setTpnGameSearch(e.target.value)}
                />
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleBulkToggleTpnProducts(true)}
                    className="px-3 py-1.5 bg-green-50 text-green-700 hover:bg-green-100 border border-green-200 text-xs font-bold rounded-lg transition-colors"
                  >
                    Enable All Filtered
                  </button>
                  <button 
                    onClick={() => handleBulkToggleTpnProducts(false)}
                    className="px-3 py-1.5 bg-red-50 text-red-700 hover:bg-red-100 border border-red-200 text-xs font-bold rounded-lg transition-colors"
                  >
                    Disable All Filtered
                  </button>
                </div>
              </div>
`;

if (ui.includes(targetSearchDiv)) {
  ui = ui.replace(targetSearchDiv, replaceSearchDiv);
  fs.writeFileSync('src/App_v2.tsx', ui);
  console.log('patched TopUpNation search div');
} else {
  console.log('Could not find TopUpNation search div');
}
