/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useState } from 'react';

export default function App() {
  const [isConfigured, setIsConfigured] = useState<boolean | null>(null);
  
  // Login Form State
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [showLoginModal, setShowLoginModal] = useState(false);

  
  // Owner & Balance State
  const [adminChatId, setAdminChatId] = useState('');
  const [lootbarBalance, setLootbarBalance] = useState<any>(null);
  const [balanceInput, setBalanceInput] = useState<Record<string, string>>({});

  // Dashboard State
  const [games, setGames] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [savedGames, setSavedGames] = useState<any[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  
  // Telegram Users State
  const [telegramUsers, setTelegramUsers] = useState<any[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [newChatId, setNewChatId] = useState('');
  
  // Force dashboard re-fetch
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    // Check if configured
    fetch('/api/settings/lootbar/status')
      .then(res => res.json())
      .then(data => {
        setIsConfigured(data.isConfigured);
      })
      .catch(() => setIsConfigured(false));
      
    // Always load the DB parts immediately
    
      fetch('/api/settings/admin')
        .then(res => res.json())
        .then(data => {
          if(data.success) setAdminChatId(data.adminChatId);
        });
      fetch('/api/lootbar/balance')
        .then(res => res.json())
        .then(data => {
          if(data.success) setLootbarBalance(data.data);
        });

      fetchSavedGames();
    fetchTelegramUsers();
  }, []);

  useEffect(() => {
    if (isConfigured === true) {
      setLoading(true);
      fetch('/api/games')
        .then(res => res.json())
        .then(data => {
          if (data.error) {
            setLoginError(data.error);
            setIsConfigured(false); // Drop back to login if fetch fails
          } else {
            setGames(data?.data?.items || []);
          }
        })
        .catch(err => console.error(err))
        .finally(() => setLoading(false));
    }
  }, [isConfigured, refreshKey]);

  const fetchTelegramUsers = () => {
    setLoadingUsers(true);
    fetch('/api/telegram-users')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setTelegramUsers(data.data);
        }
      })
      .catch(err => console.error(err))
      .finally(() => setLoadingUsers(false));
  };

  
  const handleSaveAdmin = () => {
    fetch('/api/settings/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminChatId })
    })
      .then(res => res.json())
      .then(() => alert('Admin Chat ID saved!'));
  };

  const handleAddBalance = (chatId: string) => {
    const amount = Number(balanceInput[chatId]);
    if (!amount || isNaN(amount)) return alert('Invalid amount');
    fetch('/api/telegram-users/balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, amount })
    })
      .then(res => res.json())
      .then(() => {
        setBalanceInput({ ...balanceInput, [chatId]: '' });
        fetchTelegramUsers();
      });
  };

  const handleAuthUser = (chatId: string) => {
    if (!chatId) return;
    fetch('/api/telegram-users/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId })
    })
      .then(res => res.json())
      .then(() => {
        setNewChatId('');
        fetchTelegramUsers();
      })
      .catch(err => console.error(err));
  };

  const handleUnauthUser = (chatId: string) => {
    fetch('/api/telegram-users/unauth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId })
    })
      .then(res => res.json())
      .then(() => {
        fetchTelegramUsers();
      })
      .catch(err => console.error(err));
  };

  const handleToggleNotifications = (chatId: string, currentStatus: boolean) => {
    fetch('/api/telegram-users/toggle-notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, receivesNotifications: !currentStatus })
    })
      .then(res => res.json())
      .then(() => {
        fetchTelegramUsers();
      })
      .catch(err => console.error(err));
  };

  const fetchSavedGames = () => {
    setLoadingSaved(true);
    fetch('/api/saved-games')
      .then(res => res.json())
      .then(data => {
        if (data.data) {
          setSavedGames(data.data);
        }
      })
      .catch(err => console.error("Error fetching saved games:", err))
      .finally(() => setLoadingSaved(false));
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoggingIn(true);
    setLoginError('');

    fetch('/api/settings/lootbar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, nickname })
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to login');
        setIsConfigured(true);
        setShowLoginModal(false);
      })
      .catch((err) => {
        setLoginError(err.message);
      })
      .finally(() => {
        setIsLoggingIn(false);
      });
  };

  const saveGame = (gameId: string, name: string) => {
    fetch('/api/saved-games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, name })
    })
      .then(res => res.json())
      .then(() => {
        fetchSavedGames();
      })
      .catch(err => console.error("Failed to save game:", err));
  };

  const deleteSavedGame = (gameId: string) => {
    fetch(`/api/saved-games/${gameId}`, {
      method: 'DELETE'
    })
      .then(res => res.json())
      .then(() => {
        fetchSavedGames();
      })
      .catch(err => console.error("Failed to delete saved game:", err));
  };

  if (isConfigured === null) {
    // Optionally we could fetchSavedGames and fetchTelegramUsers early, 
    // but fetching them after status is fine too. 
    // We'll let it show the dashboard immediately instead of blocking.
  }

  return (
    <div className="min-h-screen bg-neutral-50 text-neutral-900 p-8">
      {/* Login Modal */}
      {showLoginModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-neutral-200 w-full max-w-md relative">
            <button 
              onClick={() => setShowLoginModal(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-600 font-bold"
            >
              ✕
            </button>
            <div className="text-center mb-8">
              <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">LootBar Login</h1>
              <p className="text-neutral-500 mt-2 text-sm">Please provide your LootBar account details to access the API</p>
            </div>

            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Account UID (Nickname)</label>
                <input 
                  type="text" 
                  required
                  placeholder="e.g. U1071465635"
                  value={nickname}
                  onChange={e => setNickname(e.target.value)}
                  className="w-full px-4 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Email Address</label>
                <input 
                  type="email" 
                  required
                  placeholder="your@email.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Password</label>
                <input 
                  type="password" 
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="w-full px-4 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                />
              </div>

              {loginError && (
                <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100">
                  {loginError}
                </div>
              )}

              <button 
                type="submit" 
                disabled={isLoggingIn}
                className="w-full py-2.5 bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-400 text-white font-medium rounded-lg transition-colors mt-6"
              >
                {isLoggingIn ? 'Verifying...' : 'Login & Save Credentials'}
              </button>
            </form>
          </div>
        </div>
      )}

      <div className="max-w-3xl mx-auto space-y-8">
        
        <div className="flex justify-between items-center bg-white p-6 rounded-xl shadow-sm border border-neutral-200">
          <div>
            <h1 className="text-xl font-bold">LootBar Dashboard</h1>
            <p className="text-neutral-500 text-sm">
              {isConfigured ? 'Authenticated and connected to API' : 'Not connected to LootBar'}
            </p>
          </div>
          <button 
            onClick={() => setShowLoginModal(true)}
            className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-sm font-medium rounded-lg transition-colors"
          >
            {isConfigured ? 'Update Credentials' : 'Login to LootBar'}
          </button>
        </div>

        {/* Owner Info & Real Balance */}
        <div className="bg-white p-8 rounded-xl shadow-sm border border-neutral-200">
          <div className="flex flex-col md:flex-row gap-8 justify-between">
            <div className="flex-1">
              <h2 className="text-lg font-bold text-neutral-900 mb-4">Owner Settings</h2>
              <div className="flex gap-3">
                <input 
                  type="text" 
                  placeholder="Owner Telegram Chat ID"
                  value={adminChatId}
                  onChange={e => setAdminChatId(e.target.value)}
                  className="flex-1 px-4 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
                <button 
                  onClick={handleSaveAdmin}
                  className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white font-medium rounded-lg transition-colors whitespace-nowrap"
                >
                  Save Owner
                </button>
              </div>
              <p className="text-xs text-neutral-500 mt-2">This ID will receive notifications and have admin access in the Telegram Bot.</p>
            </div>
            
            <div className="md:w-64 bg-neutral-50 rounded-xl p-5 border border-neutral-100 flex flex-col justify-center items-center">
              <span className="text-sm text-neutral-500 font-medium mb-1">LootBar Balance (Real)</span>
              {lootbarBalance ? (
                <div className="text-3xl font-bold text-emerald-600">
                  {lootbarBalance.balance || '0.00'} <span className="text-lg text-emerald-700">{lootbarBalance.currency || 'USD'}</span>
                </div>
              ) : (
                <div className="text-neutral-400 italic text-sm">Not available</div>
              )}
            </div>
          </div>
        </div>

        {/* LootBar API Games */}
        <div className="bg-white p-8 rounded-xl shadow-sm border border-neutral-200">
          <div className="flex justify-between items-center mb-6">
            <h2 className="text-lg font-bold">Available Games (from API)</h2>
            {isConfigured && (
              <button 
                onClick={() => setRefreshKey(k => k + 1)}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                Refresh
              </button>
            )}
          </div>

          {isConfigured === null ? (
            <p className="text-neutral-500 py-4 text-center">Checking API connection...</p>
          ) : isConfigured === false ? (
            <div className="text-center py-12 bg-neutral-50 rounded-lg border border-neutral-200 border-dashed">
              <p className="text-neutral-500 mb-4">LootBar API is not configured.</p>
              <button 
                onClick={() => setShowLoginModal(true)}
                className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white font-medium rounded-lg transition-colors"
              >
                Connect LootBar
              </button>
            </div>
          ) : loading ? (
            <p className="text-neutral-500 py-4 text-center">Loading games from API...</p>
          ) : games.length === 0 ? (
            <p className="text-red-500">Failed to load games. Credentials might be invalid.</p>
          ) : (
            <ul className="space-y-3">
              {games.map((game, i) => (
                <li key={i} className="px-4 py-3 bg-neutral-50 border border-neutral-100 rounded-lg flex justify-between items-center">
                  <div>
                    <span className="font-semibold block">{game.name || 'Unknown'}</span>
                    <span className="text-xs text-neutral-500 font-mono mt-1 block">Game ID: {game.id || game.game_id}</span>
                  </div>
                  <button 
                    onClick={() => saveGame(game.id || game.game_id, game.name || 'Unknown')}
                    className="px-4 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white text-sm font-medium rounded-lg transition-colors shadow-sm"
                  >
                    Save to DB
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* MongoDB Saved Games */}
        <div className="bg-white p-8 rounded-xl shadow-sm border border-neutral-200">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-lg font-bold text-neutral-900">Saved Games DB</h2>
              <p className="text-sm text-neutral-500 mt-1">Games tracking in MongoDB</p>
            </div>
          </div>
          
          {loadingSaved ? (
            <p className="text-neutral-500 py-4 text-center">Loading saved games...</p>
          ) : savedGames.length === 0 ? (
            <div className="text-center py-12 bg-neutral-50 rounded-lg border border-neutral-200 border-dashed">
              <p className="text-neutral-500">No games saved yet.</p>
              <p className="text-sm text-neutral-400 mt-1">Save a game from the list above.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {savedGames.map((saved, i) => (
                <li key={i} className="px-4 py-3 bg-white border border-neutral-200 shadow-sm rounded-lg flex justify-between items-center">
                  <div>
                    <span className="font-semibold block text-neutral-800">{saved.name}</span>
                    <span className="text-xs text-neutral-400 mt-1 block">Saved: {new Date(saved.savedAt).toLocaleString()}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-neutral-500 font-mono bg-neutral-100 px-2 py-1 rounded">ID: {saved.gameId}</span>
                    <button 
                      onClick={() => deleteSavedGame(saved.gameId)}
                      className="text-neutral-400 hover:text-red-600 transition-colors p-2 rounded-md hover:bg-red-50"
                      title="Remove game"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18"></path>
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
                      </svg>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Telegram User Management */}
        <div className="bg-white p-8 rounded-xl shadow-sm border border-neutral-200">
          <div className="flex justify-between items-center mb-6">
            <div>
              <h2 className="text-lg font-bold text-neutral-900">Telegram Users</h2>
              <p className="text-sm text-neutral-500 mt-1">Manage authorized users for the bot</p>
            </div>
            <button 
              onClick={fetchTelegramUsers}
              className="text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              Refresh
            </button>
          </div>

          <div className="mb-6 flex gap-3">
            <input 
              type="text" 
              placeholder="Enter Telegram Chat ID"
              value={newChatId}
              onChange={e => setNewChatId(e.target.value)}
              className="flex-1 px-4 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
            <button 
              onClick={() => handleAuthUser(newChatId)}
              disabled={!newChatId}
              className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-400 text-white font-medium rounded-lg transition-colors"
            >
              Authorize
            </button>
          </div>
          
          {loadingUsers ? (
            <p className="text-neutral-500 py-4 text-center">Loading users...</p>
          ) : telegramUsers.length === 0 ? (
            <div className="text-center py-12 bg-neutral-50 rounded-lg border border-neutral-200 border-dashed">
              <p className="text-neutral-500">No users found.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {telegramUsers.map((user, i) => (
                <li key={i} className="px-4 py-3 bg-white border border-neutral-200 shadow-sm rounded-lg flex justify-between items-center">
                  <div>
                    <span className="font-semibold block text-neutral-800">Chat ID: {user.telegramChatId}</span>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-neutral-500">Balance: ${user.balance || 0}</span>
                      {user.receivesNotifications && (
                        <span className="text-[10px] font-medium text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200">
                          Gets Alerts
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-3">
                    <div className="flex items-center gap-3">
                      {user.isAuthorized ? (
                        <span className="text-xs font-medium text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                          Authorized
                        </span>
                      ) : (
                        <span className="text-xs font-medium text-red-700 bg-red-50 px-2.5 py-1 rounded-full border border-red-200">
                          Unauthorized
                        </span>
                      )}
                      
                      <button 
                        onClick={() => handleToggleNotifications(user.telegramChatId, user.receivesNotifications)}
                        className={`text-sm font-medium px-3 py-1.5 rounded-md transition-colors ${
                          user.receivesNotifications
                            ? 'text-neutral-600 hover:bg-neutral-100'
                            : 'text-blue-600 hover:bg-blue-50'
                        }`}
                        title="Toggle receiving new order notifications"
                      >
                        {user.receivesNotifications ? 'Mute' : 'Notify'}
                      </button>

                      <button 
                        onClick={() => user.isAuthorized ? handleUnauthUser(user.telegramChatId) : handleAuthUser(user.telegramChatId)}
                        className={`text-sm font-medium px-3 py-1.5 rounded-md transition-colors ${
                          user.isAuthorized 
                            ? 'text-red-600 hover:bg-red-50' 
                            : 'text-emerald-600 hover:bg-emerald-50'
                        }`}
                      >
                        {user.isAuthorized ? 'Revoke' : 'Approve'}
                      </button>
                    </div>
                    
                    {user.isAuthorized && (
                      <div className="flex items-center gap-2 mt-2">
                        <input
                          type="number"
                          placeholder="Amount"
                          value={balanceInput[user.telegramChatId] || ''}
                          onChange={(e) => setBalanceInput({ ...balanceInput, [user.telegramChatId]: e.target.value })}
                          className="w-24 px-2 py-1 text-sm border border-neutral-300 rounded outline-none focus:border-blue-500"
                        />
                        <button
                          onClick={() => handleAddBalance(user.telegramChatId)}
                          disabled={!balanceInput[user.telegramChatId]}
                          className="text-xs bg-emerald-100 hover:bg-emerald-200 text-emerald-800 font-medium px-2 py-1.5 rounded transition-colors disabled:opacity-50"
                        >
                          + Add
                        </button>
                        <button
                          onClick={() => {
                            const val = balanceInput[user.telegramChatId];
                            if(val) {
                              setBalanceInput({ ...balanceInput, [user.telegramChatId]: `-${Math.abs(Number(val))}` });
                              setTimeout(() => handleAddBalance(user.telegramChatId), 0);
                            }
                          }}
                          disabled={!balanceInput[user.telegramChatId]}
                          className="text-xs bg-rose-100 hover:bg-rose-200 text-rose-800 font-medium px-2 py-1.5 rounded transition-colors disabled:opacity-50"
                        >
                          - Deduct
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>
    </div>
  );
}
