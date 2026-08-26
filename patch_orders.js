import fs from 'fs';
let content = fs.readFileSync('src/App_v2.tsx', 'utf8');

const target = `            if (filteredOrders.length === 0) {
              return (
                <div className="text-center py-10 bg-neutral-50 rounded-xl border border-neutral-200 border-dashed">
                  <p className="text-neutral-500 mb-2">No orders match your filter/search criteria.</p>
                  <button onClick={() => {setOrderFilter('ALL'); setOrderProviderFilter('ALL'); setOrderSearch('');}} className="text-blue-600 hover:underline text-sm font-medium">Clear filters</button>
                </div>
              );
            }

            return (
              <div className="overflow-x-auto">`;

const replacement = `            const ORDERS_PER_PAGE = 10;
            const totalOrderPages = Math.ceil(filteredOrders.length / ORDERS_PER_PAGE);
            
            // Ensure orderPage is within bounds if filter changes
            const validOrderPage = Math.min(orderPage, totalOrderPages) || 1;
            const paginatedOrders = filteredOrders.slice((validOrderPage - 1) * ORDERS_PER_PAGE, validOrderPage * ORDERS_PER_PAGE);

            if (filteredOrders.length === 0) {
              return (
                <div className="text-center py-10 bg-neutral-50 rounded-xl border border-neutral-200 border-dashed">
                  <p className="text-neutral-500 mb-2">No orders match your filter/search criteria.</p>
                  <button onClick={() => {setOrderFilter('ALL'); setOrderProviderFilter('ALL'); setOrderSearch(''); setOrderPage(1);}} className="text-blue-600 hover:underline text-sm font-medium">Clear filters</button>
                </div>
              );
            }

            return (
              <div className="flex flex-col gap-4">
              <div className="overflow-x-auto rounded-xl border border-neutral-200">`;

content = content.replace(target, replacement);

const mapTarget = `                <tbody className="divide-y divide-neutral-100 bg-white">
                  {filteredOrders.map((o) => {`;

const mapReplacement = `                <tbody className="divide-y divide-neutral-100 bg-white">
                  {paginatedOrders.map((o) => {`;

content = content.replace(mapTarget, mapReplacement);

// Find where the orders table ends.
const endTarget = `                    );
                  })}
                </tbody>
              </table>
            );
          })()}`;

const endReplacement = `                    );
                  })}
                </tbody>
              </table>
              </div>
              
              {/* Pagination Controls */}
              {totalOrderPages > 1 && (
                <div className="flex items-center justify-between px-2 pt-2">
                  <span className="text-xs text-neutral-500">
                    Showing <span className="font-semibold text-neutral-900">{((validOrderPage - 1) * ORDERS_PER_PAGE) + 1}</span> to <span className="font-semibold text-neutral-900">{Math.min(validOrderPage * ORDERS_PER_PAGE, filteredOrders.length)}</span> of <span className="font-semibold text-neutral-900">{filteredOrders.length}</span> orders
                  </span>
                  
                  <div className="flex items-center gap-1.5">
                    <button 
                      disabled={validOrderPage === 1}
                      onClick={() => setOrderPage(validOrderPage - 1)}
                      className="px-2 py-1 bg-white border border-neutral-300 rounded text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 transition-colors"
                    >
                      Previous
                    </button>
                    <div className="flex items-center gap-1">
                      {Array.from({ length: Math.min(5, totalOrderPages) }, (_, i) => {
                        let pageNum;
                        if (totalOrderPages <= 5) {
                          pageNum = i + 1;
                        } else if (validOrderPage <= 3) {
                          pageNum = i + 1;
                        } else if (validOrderPage >= totalOrderPages - 2) {
                          pageNum = totalOrderPages - 4 + i;
                        } else {
                          pageNum = validOrderPage - 2 + i;
                        }
                        return (
                          <button
                            key={pageNum}
                            onClick={() => setOrderPage(pageNum)}
                            className={\`w-6 h-6 flex items-center justify-center rounded text-xs font-semibold transition-colors \${validOrderPage === pageNum ? 'bg-indigo-600 text-white' : 'bg-white text-neutral-600 border border-neutral-300 hover:bg-neutral-50'}\`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                    </div>
                    <button 
                      disabled={validOrderPage === totalOrderPages}
                      onClick={() => setOrderPage(validOrderPage + 1)}
                      className="px-2 py-1 bg-white border border-neutral-300 rounded text-xs font-medium text-neutral-700 hover:bg-neutral-50 disabled:opacity-50 transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
              </div>
            );
          })()}`;

content = content.replace(endTarget, endReplacement);
fs.writeFileSync('src/App_v2.tsx', content);
