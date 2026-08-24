/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useState } from 'react';

// Myanmar Timezone (GMT+6:30 / Asia/Yangon) formatters
function formatMyanmarDate(date: Date | string | number | undefined): string {
  try {
    if (!date) return '-';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleDateString('en-GB', {
      timeZone: 'Asia/Yangon',
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  } catch (e) {
    return String(date);
  }
}

function formatMyanmarTime(date: Date | string | number | undefined): string {
  try {
    if (!date) return '-';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleTimeString('en-US', {
      timeZone: 'Asia/Yangon',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  } catch (e) {
    return String(date);
  }
}

function formatMyanmarDateTime(date: Date | string | number | undefined): string {
  try {
    if (!date) return '-';
    const d = new Date(date);
    if (isNaN(d.getTime())) return '-';
    return d.toLocaleString('en-GB', {
      timeZone: 'Asia/Yangon',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true
    });
  } catch (e) {
    return String(date);
  }
}

async function safeFetchJson<T = any>(url: string, options?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, options);
    const contentType = res.headers.get('content-type') || '';
    if (!res.ok || !contentType.includes('application/json')) {
      return null;
    }
    return await res.json();
  } catch (e) {
    return null;
  }
}

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
  const [telegramBotToken, setTelegramBotToken] = useState('');
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
  const [userFilter, setUserFilter] = useState<'ALL' | 'API' | 'WALLET' | 'PENDING'>('ALL');
  const [userSearch, setUserSearch] = useState('');
  const [editingNotes, setEditingNotes] = useState<Record<string, string>>({});
  const [togglingApiUser, setTogglingApiUser] = useState<string | null>(null);
  const [savingNotesId, setSavingNotesId] = useState<string | null>(null);
  
  // Orders State & Real-Time Tracking
  const [orders, setOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [syncingRefId, setSyncingRefId] = useState<string | null>(null);
  const [orderFilter, setOrderFilter] = useState<'ALL' | 'ACTIVE' | 'COMPLETED' | 'FAILED'>('ALL');
  const [orderProviderFilter, setOrderProviderFilter] = useState<'ALL' | 'LOOTBAR' | 'TOPUPNATION'>('ALL');
  const [orderSearch, setOrderSearch] = useState('');
  const [selectedTrackingOrder, setSelectedTrackingOrder] = useState<any | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<Date>(new Date());
  const [isAutoSyncing, setIsAutoSyncing] = useState(true);

  // Force dashboard re-fetch
  const [refreshKey, setRefreshKey] = useState(0);

  // TopUpNation Reseller API State
  const [tpnConfigured, setTpnConfigured] = useState<boolean | null>(null);
  const [tpnApiKey, setTpnApiKey] = useState('');
  const [tpnApiSecret, setTpnApiSecret] = useState('');
  const [tpnWebhookSecret, setTpnWebhookSecret] = useState('');
  const [tpnBaseUrl, setTpnBaseUrl] = useState('https://topupnation.io');
  const [tpnWebhookUrl, setTpnWebhookUrl] = useState('');
  const [tpnBalance, setTpnBalance] = useState<any>(null);
  const [tpnProducts, setTpnProducts] = useState<any[]>([]);
  const [loadingTpnProducts, setLoadingTpnProducts] = useState(false);
  const [isSyncingTpn, setIsSyncingTpn] = useState(false);
  const [tpnShortKeyInput, setTpnShortKeyInput] = useState<Record<string, string>>({});
  const [showTpnModal, setShowTpnModal] = useState(false);
  const [tpnError, setTpnError] = useState('');
  const [isSavingTpn, setIsSavingTpn] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const fetchTpnStatus = async () => {
    try {
      const data = await safeFetchJson('/api/settings/topupnation/status');
      if (data) {
        setTpnConfigured(!!data.isConfigured);
        if (data.baseUrl) setTpnBaseUrl(data.baseUrl);
        if (data.webhookUrl) {
          setTpnWebhookUrl(data.webhookUrl);
        } else {
          setTpnWebhookUrl(`${window.location.origin}/api/webhooks/topupnation`);
        }
        if (data.isConfigured) {
          fetchTpnBalance();
          fetchTpnProducts();
        }
      } else {
        setTpnConfigured(false);
        setTpnWebhookUrl(`${window.location.origin}/api/webhooks/topupnation`);
      }
    } catch {
      setTpnConfigured(false);
    }
  };

  const fetchTpnBalance = async () => {
    const data = await safeFetchJson('/api/topupnation/balance');
    if (data?.success && data?.data) {
      setTpnBalance(data.data);
    }
  };

  const fetchTpnProducts = async () => {
    setLoadingTpnProducts(true);
    try {
      const data = await safeFetchJson('/api/topupnation/products');
      if (data?.success && Array.isArray(data.data || data.products)) {
        setTpnProducts(data.data || data.products || []);
      }
    } finally {
      setLoadingTpnProducts(false);
    }
  };

  const handleSyncTpnProducts = async () => {
    setIsSyncingTpn(true);
    try {
      const res = await fetch('/api/topupnation/products/sync', { method: 'POST' });
      const data = await res.json();
      if (data?.success) {
        fetchTpnProducts();
      } else {
        alert(`Failed to sync: ${data?.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Error syncing products: ${err.message}`);
    } finally {
      setIsSyncingTpn(false);
    }
  };

  const handleSaveTpnCredentials = async (e: React.FormEvent) => {
    e.preventDefault();
    setTpnError('');
    setIsSavingTpn(true);
    try {
      const res = await fetch('/api/settings/topupnation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          apiKey: tpnApiKey,
          apiSecret: tpnApiSecret,
          webhookSecret: tpnWebhookSecret,
          baseUrl: tpnBaseUrl
        })
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        setTpnError(data.error || 'Failed to authenticate with TopUpNation');
      } else {
        setShowTpnModal(false);
        setTpnConfigured(true);
        fetchTpnStatus();
        fetchTpnBalance();
        handleSyncTpnProducts();
      }
    } catch (err: any) {
      setTpnError(err.message || 'Connection error');
    } finally {
      setIsSavingTpn(false);
    }
  };

  const handleSaveTpnShortKey = async (productId: string) => {
    const key = tpnShortKeyInput[productId];
    if (key === undefined) return;
    try {
      const res = await fetch(`/api/topupnation/products/${productId}/shortkey`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortKey: key })
      });
      const data = await res.json();
      if (data?.success) {
        fetchTpnProducts();
      } else {
        alert(data?.error || 'Failed to update shortKey');
      }
    } catch (err: any) {
      alert(`Error updating shortKey: ${err.message}`);
    }
  };

  const handleToggleTpnProduct = async (productId: string, currentEnabled: boolean) => {
    try {
      const res = await fetch(`/api/topupnation/products/${productId}/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isEnabled: !currentEnabled })
      });
      const data = await res.json();
      if (data?.success) {
        setTpnProducts(prev => prev.map(p => p.productId === productId ? { ...p, isEnabled: !currentEnabled, status: !currentEnabled ? 'ACTIVE' : 'DISABLED' } : p));
      } else {
        alert(data?.error || 'Failed to toggle product status');
      }
    } catch (err: any) {
      alert(`Error toggling product: ${err.message}`);
    }
  };

  const fetchLootbarBalance = async () => {
    const data = await safeFetchJson('/api/lootbar/balance');
    if (data?.success && data?.data) {
      setLootbarBalance(data.data);
    }
  };

  const fetchOrders = async (silent = false) => {
    if (!silent) setLoadingOrders(true);
    try {
      const data = await safeFetchJson('/api/orders');
      if (data?.success) {
        setOrders(data.data || []);
        setLastSyncTime(new Date());
        if (selectedTrackingOrder) {
          const updated = (data.data || []).find((o: any) => o.referenceId === selectedTrackingOrder.referenceId);
          if (updated) setSelectedTrackingOrder(updated);
        }
      }
    } finally {
      if (!silent) setLoadingOrders(false);
    }
  };

  // Real-time automatic polling every 4 seconds
  useEffect(() => {
    if (!isAutoSyncing) return;
    const interval = setInterval(() => {
      fetchOrders(true);
    }, 4000);
    return () => clearInterval(interval);
  }, [isAutoSyncing, selectedTrackingOrder]);

  const handleSyncOrder = async (referenceId: string) => {
    setSyncingRefId(referenceId);
    try {
      const data = await safeFetchJson(`/api/orders/${referenceId}/sync`, { method: 'POST' });
      if (data?.success && data?.data) {
        setOrders(prev => prev.map(o => o.referenceId === referenceId ? data.data : o));
        if (selectedTrackingOrder?.referenceId === referenceId) {
          setSelectedTrackingOrder(data.data);
        }
      }
    } catch (err) {
      console.error("Failed to sync order:", err);
    } finally {
      setSyncingRefId(null);
    }
  };

  const getOrderStateDetails = (state: number) => {
    switch (state) {
      case 0:
        return {
          label: 'Pending',
          stage: 'Pending',
          step: 1,
          badgeBg: 'bg-amber-50 text-amber-700 border-amber-200',
          dotBg: 'bg-amber-500',
          icon: '⏳',
          description: 'Order created, awaiting game transaction processing'
        };
      case 1:
        return {
          label: 'Processing',
          stage: 'Processing',
          step: 2,
          badgeBg: 'bg-blue-50 text-blue-700 border-blue-200',
          dotBg: 'bg-blue-500 animate-pulse',
          icon: '🔄',
          description: 'LootBar API is currently delivering top-up to player account'
        };
      case 4:
        return {
          label: 'Settling (Processing)',
          stage: 'Processing',
          step: 2,
          badgeBg: 'bg-indigo-50 text-indigo-700 border-indigo-200',
          dotBg: 'bg-indigo-500 animate-pulse',
          icon: '⚡',
          description: 'Transaction in final settlement stage'
        };
      case 2:
        return {
          label: 'Completed',
          stage: 'Completed',
          step: 3,
          badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
          dotBg: 'bg-emerald-500',
          icon: '✅',
          description: 'Top-up successfully credited to the player'
        };
      case 3:
        return {
          label: 'Failed (Refunded)',
          stage: 'Failed',
          step: 3,
          badgeBg: 'bg-rose-50 text-rose-700 border-rose-200',
          dotBg: 'bg-rose-500',
          icon: '❌',
          description: 'Order failed on game server. User balance has been refunded'
        };
      case 5:
        return {
          label: 'Partial',
          stage: 'Partial',
          step: 3,
          badgeBg: 'bg-orange-50 text-orange-700 border-orange-200',
          dotBg: 'bg-orange-500',
          icon: '⚠️',
          description: 'Order partially fulfilled'
        };
      case 6:
        return {
          label: 'Cancelled',
          stage: 'Cancelled',
          step: 3,
          badgeBg: 'bg-neutral-100 text-neutral-700 border-neutral-300',
          dotBg: 'bg-neutral-500',
          icon: '🚫',
          description: 'Order was cancelled'
        };
      default:
        return {
          label: 'Processing',
          stage: 'Processing',
          step: 2,
          badgeBg: 'bg-blue-50 text-blue-700 border-blue-200',
          dotBg: 'bg-blue-500',
          icon: '⏳',
          description: 'In progress'
        };
    }
  };

  useEffect(() => {
    // Check if configured
    fetch('/api/settings/lootbar/status')
      .then(res => res.json())
      .then(data => {
        setIsConfigured(data.isConfigured);
        if (data.isConfigured) {
          fetchLootbarBalance();
        }
      })
      .catch(() => setIsConfigured(false));
      
    // Always load the DB parts immediately
    fetch('/api/settings/admin')
      .then(res => res.json())
      .then(data => {
        if(data.success) {
          setAdminChatId(data.adminChatId || '');
          setTelegramBotToken(data.telegramBotToken || '');
        }
      });
      
    fetchLootbarBalance();
    fetchSavedGames();
    fetchTelegramUsers();
    fetchOrders();
    fetchTpnStatus();
    fetchTpnProducts();
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

      fetchLootbarBalance();
    }
  }, [isConfigured, refreshKey]);

  const fetchTelegramUsers = async () => {
    setLoadingUsers(true);
    try {
      const data = await safeFetchJson('/api/telegram-users');
      if (data?.success) {
        setTelegramUsers(data.data || []);
      }
    } finally {
      setLoadingUsers(false);
    }
  };

  
  const handleSaveAdmin = () => {
    fetch('/api/settings/admin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminChatId, telegramBotToken })
    })
      .then(res => res.json())
      .then(() => alert('Admin settings & Bot Token saved!'));
  };

  const handleAddBalance = (chatId: string) => {
    const raw = Number(balanceInput[chatId]);
    if (!raw || isNaN(raw) || raw <= 0) return alert('Please enter a valid positive amount to add');
    fetch('/api/telegram-users/balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, amount: Math.abs(raw) })
    })
      .then(res => res.json())
      .then(() => {
        setBalanceInput({ ...balanceInput, [chatId]: '' });
        fetchTelegramUsers();
      });
  };

  const handleDeductBalance = (chatId: string) => {
    const raw = Number(balanceInput[chatId]);
    if (!raw || isNaN(raw) || raw <= 0) return alert('Please enter a valid positive amount to deduct');
    fetch('/api/telegram-users/balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, amount: -Math.abs(raw) })
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

  const handleToggleApiBalance = (chatId: string, currentIsApi: boolean, apiProvider: 'both' | 'lootbar' | 'topupnation' = 'both') => {
    setTogglingApiUser(chatId);
    fetch('/api/telegram-users/toggle-api-balance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        chatId, 
        useDirectApiBalance: !currentIsApi,
        apiProvider: !currentIsApi ? apiProvider : 'both'
      })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          fetchTelegramUsers();
        } else {
          alert(data.error || 'Failed to switch balance mode');
        }
      })
      .catch(err => {
        console.error(err);
        alert('Network error switching balance mode');
      })
      .finally(() => setTogglingApiUser(null));
  };

  const handleSaveUserNotes = (chatId: string) => {
    setSavingNotesId(chatId);
    fetch('/api/telegram-users/update-notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chatId, notes: editingNotes[chatId] !== undefined ? editingNotes[chatId] : '' })
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          fetchTelegramUsers();
        }
      })
      .catch(err => console.error(err))
      .finally(() => setSavingNotesId(null));
  };

  const handleDeleteUser = (chatId: string) => {
    if (!confirm(`Are you sure you want to remove user with Chat ID ${chatId} from the bot?`)) return;
    fetch(`/api/telegram-users/${chatId}`, {
      method: 'DELETE'
    })
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          fetchTelegramUsers();
        }
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
      body: JSON.stringify({ 
        email: email.trim(), 
        password: password.trim(), 
        nickname: nickname.trim() 
      })
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

  const [savingKeyId, setSavingKeyId] = useState<string | null>(null);
  const [shortKeyInputs, setShortKeyInputs] = useState<Record<string, string>>({});

  const saveGame = (gameId: string, name: string, shortKey?: string) => {
    fetch('/api/saved-games', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameId, name, shortKey })
    })
      .then(res => res.json())
      .then(() => {
        fetchSavedGames();
      })
      .catch(err => console.error("Failed to save game:", err));
  };

  const updateGameShortKey = async (gameId: string, shortKey: string) => {
    setSavingKeyId(gameId);
    try {
      const res = await fetch(`/api/saved-games/${gameId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shortKey })
      });
      const data = await res.json();
      if (data.success) {
        fetchSavedGames();
      }
    } catch (err) {
      console.error("Failed to update shortKey:", err);
    } finally {
      setSavingKeyId(null);
    }
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
      {/* TopupNation Settings Modal */}
      {showTpnModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white p-8 rounded-2xl shadow-sm border border-neutral-200 w-full max-w-lg relative">
            <button 
              onClick={() => setShowTpnModal(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-600 font-bold text-lg"
            >
              ✕
            </button>
            <div className="text-center mb-6">
              <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center mx-auto mb-3 font-bold text-xl">
                🌐
              </div>
              <h1 className="text-2xl font-bold text-neutral-900 tracking-tight">TopupNation Reseller API</h1>
              <p className="text-neutral-500 mt-1 text-sm">Configure your TopupNation Reseller credentials and webhook</p>
            </div>

            <form onSubmit={handleSaveTpnCredentials} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">API Key</label>
                <input 
                  type="text" 
                  required
                  placeholder="e.g. tpn_live_..."
                  value={tpnApiKey}
                  onChange={e => setTpnApiKey(e.target.value)}
                  className="w-full px-4 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">API Secret (HMAC-SHA256)</label>
                <input 
                  type="password" 
                  required
                  placeholder="••••••••••••••••"
                  value={tpnApiSecret}
                  onChange={e => setTpnApiSecret(e.target.value)}
                  className="w-full px-4 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">Webhook Secret (Optional)</label>
                <input 
                  type="password" 
                  placeholder="Webhook signing secret"
                  value={tpnWebhookSecret}
                  onChange={e => setTpnWebhookSecret(e.target.value)}
                  className="w-full px-4 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-mono text-sm"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-neutral-700 mb-1">API Base URL</label>
                <input 
                  type="text" 
                  placeholder="https://topupnation.io/api/v1"
                  value={tpnBaseUrl}
                  onChange={e => setTpnBaseUrl(e.target.value)}
                  className="w-full px-4 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none font-mono text-sm text-neutral-600"
                />
              </div>

              {tpnWebhookUrl && (
                <div className="p-3 bg-indigo-50 border border-indigo-100 rounded-lg text-xs">
                  <span className="font-semibold text-indigo-900 block mb-1">📌 Your Webhook Callback URL:</span>
                  <div className="flex items-center gap-2">
                    <code className="bg-white px-2 py-1 rounded border border-indigo-200 text-indigo-700 flex-1 truncate font-mono">
                      {tpnWebhookUrl}
                    </code>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(tpnWebhookUrl);
                        alert('Copied webhook URL!');
                      }}
                      className="px-2.5 py-1 bg-indigo-600 text-white rounded font-medium hover:bg-indigo-700 transition-colors"
                    >
                      Copy
                    </button>
                  </div>
                  <p className="text-indigo-600 mt-1 text-[11px]">Set this URL in TopupNation Reseller Portal to receive instant order updates.</p>
                </div>
              )}

              {tpnError && (
                <div className="p-3 bg-red-50 text-red-600 rounded-lg text-sm border border-red-100">
                  {tpnError}
                </div>
              )}

              <button 
                type="submit" 
                disabled={isSavingTpn}
                className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-neutral-400 text-white font-medium rounded-lg transition-colors mt-4"
              >
                {isSavingTpn ? 'Verifying & Connecting...' : 'Save & Verify TopupNation API'}
              </button>
            </form>
          </div>
        </div>
      )}

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

      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Multi-Provider Header */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-neutral-200">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-neutral-900">Reseller API Dashboard</h1>
                <span className="text-xs bg-neutral-100 text-neutral-700 font-semibold px-2 py-0.5 rounded-full">Multi-Provider</span>
              </div>
              <p className="text-neutral-500 text-sm mt-0.5">
                Manage integrated providers: LootBar API & TopUpNation API
              </p>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button 
                onClick={() => setShowLoginModal(true)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 ${
                  isConfigured 
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100' 
                    : 'bg-neutral-100 text-neutral-700 border-neutral-200 hover:bg-neutral-200'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${isConfigured ? 'bg-emerald-500' : 'bg-neutral-400'}`}></span>
                LootBar API: {isConfigured ? 'Connected' : 'Setup'}
              </button>

              <button 
                onClick={() => setShowTpnModal(true)}
                className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors flex items-center gap-1.5 ${
                  tpnConfigured 
                    ? 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100' 
                    : 'bg-neutral-100 text-neutral-700 border-neutral-200 hover:bg-neutral-200'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${tpnConfigured ? 'bg-indigo-500' : 'bg-neutral-400'}`}></span>
                TopupNation API: {tpnConfigured ? 'Connected' : 'Setup'}
              </button>
            </div>
          </div>
        </div>

        {/* Owner Settings & Reseller Balances */}
        <div className="bg-white p-8 rounded-xl shadow-sm border border-neutral-200">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Owner settings */}
            <div className="lg:col-span-5 flex flex-col justify-between">
              <div>
                <h2 className="text-lg font-bold text-neutral-900 mb-1">Telegram Bot Settings</h2>
                <p className="text-xs text-neutral-500 mb-4">Configure your bot token and admin chat ID</p>
                
                <div className="space-y-3 mb-4">
                  <div className="flex flex-col">
                    <label className="text-xs font-semibold text-neutral-600 mb-1">Bot Token</label>
                    <input 
                      type="password" 
                      placeholder="123456789:ABCdefGHIjklMNO..."
                      value={telegramBotToken}
                      onChange={e => setTelegramBotToken(e.target.value)}
                      className="w-full px-3.5 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                    />
                  </div>
                  <div className="flex flex-col">
                    <label className="text-xs font-semibold text-neutral-600 mb-1">Admin Chat ID</label>
                    <input 
                      type="text" 
                      placeholder="Owner Chat ID"
                      value={adminChatId}
                      onChange={e => setAdminChatId(e.target.value)}
                      className="w-full px-3.5 py-2 border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                    />
                  </div>
                </div>

                <div className="flex justify-end">
                  <button 
                    onClick={handleSaveAdmin}
                    className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap w-full"
                  >
                    Save Bot Settings
                  </button>
                </div>
              </div>
            </div>
            
            {/* LootBar Balance Card */}
            <div className="lg:col-span-3.5 bg-gradient-to-br from-emerald-600 to-teal-700 rounded-xl p-5 shadow-md border border-emerald-500 flex flex-col justify-between text-white relative overflow-hidden">
              <div className="flex items-center justify-between w-full relative z-10 mb-2">
                <span className="text-[11px] font-bold text-emerald-100 uppercase tracking-wider">LootBar Balance</span>
                <button 
                  onClick={fetchLootbarBalance}
                  title="Refresh Balance"
                  className="p-1 hover:bg-white/20 rounded transition-colors text-emerald-100"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                </button>
              </div>

              {lootbarBalance ? (
                <div className="text-2xl font-extrabold relative z-10 flex items-baseline gap-1">
                  ${lootbarBalance.total_amount || lootbarBalance.balance || '0.00'} 
                  <span className="text-xs text-emerald-200 font-semibold">USD</span>
                </div>
              ) : (
                <div className="text-xs text-emerald-200 relative z-10 italic">Not connected</div>
              )}
            </div>

            {/* TopupNation Balance Card */}
            <div className="lg:col-span-3.5 bg-gradient-to-br from-indigo-600 to-violet-700 rounded-xl p-5 shadow-md border border-indigo-500 flex flex-col justify-between text-white relative overflow-hidden">
              <div className="flex items-center justify-between w-full relative z-10 mb-2">
                <span className="text-[11px] font-bold text-indigo-100 uppercase tracking-wider">TopupNation Balance</span>
                <button 
                  onClick={fetchTpnStatus}
                  title="Refresh Balance"
                  className="p-1 hover:bg-white/20 rounded transition-colors text-indigo-100"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                </button>
              </div>

              {tpnBalance ? (
                <div className="text-2xl font-extrabold relative z-10 flex items-baseline gap-1">
                  ${Number(tpnBalance.balance || 0).toFixed(2)} 
                  <span className="text-xs text-indigo-200 font-semibold">{tpnBalance.currency || 'USD'}</span>
                </div>
              ) : (
                <div className="text-xs text-indigo-200 relative z-10 italic">
                  {tpnConfigured ? 'Loading...' : 'Not connected'}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* TopupNation Products Management */}
        <div className="bg-white p-8 rounded-xl shadow-sm border border-neutral-200">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-2">
            <h2 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
              <span>🌐</span> TopUpNation Products Catalog
            </h2>
            <div className="flex items-center gap-2">
              <button 
                onClick={handleSyncTpnProducts}
                disabled={isSyncingTpn || !tpnConfigured}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-neutral-300 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5"
              >
                <svg className={`w-3.5 h-3.5 ${isSyncingTpn ? 'animate-spin' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {isSyncingTpn ? 'Syncing Catalog...' : 'Sync TopupNation Catalog'}
              </button>
            </div>
          </div>
          <p className="text-sm text-neutral-500 mb-6">
            Synced products from TopupNation. Set custom Short Keys for rapid ordering in Telegram (e.g. <span className="font-mono font-semibold text-neutral-800">.tp</span> or <span className="font-mono font-semibold text-neutral-800">.tml</span>).
          </p>

          {!tpnConfigured ? (
            <div className="text-center py-10 bg-neutral-50 rounded-lg border border-neutral-200 border-dashed">
              <p className="text-neutral-500 mb-3 text-sm">TopupNation API is not connected.</p>
              <button 
                onClick={() => setShowTpnModal(true)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                Connect TopupNation API
              </button>
            </div>
          ) : loadingTpnProducts ? (
            <p className="text-neutral-500 py-6 text-center text-sm">Loading TopupNation products...</p>
          ) : tpnProducts.length === 0 ? (
            <div className="text-center py-8 bg-neutral-50 rounded-lg border border-neutral-200 text-sm text-neutral-500">
              No products synced yet. Click <span className="font-semibold text-indigo-600">"Sync TopupNation Catalog"</span> to import products.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {tpnProducts.map((p) => {
                const activeKey = p.shortKey || '';
                const currentInput = tpnShortKeyInput[p.productId] !== undefined ? tpnShortKeyInput[p.productId] : activeKey;
                const isModified = currentInput !== activeKey;
                const isEnabled = p.isEnabled !== false && p.status !== 'DISABLED';

                return (
                  <div 
                    key={p.productId} 
                    className={`p-5 bg-white border-2 rounded-2xl transition-all flex flex-col justify-between ${
                      isEnabled 
                        ? 'border-indigo-500 shadow-md ring-1 ring-indigo-500/20' 
                        : 'border-neutral-200 hover:border-neutral-300 shadow-sm opacity-75'
                    }`}
                  >
                    <div className="mb-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="font-extrabold text-base text-neutral-900 leading-tight">{p.name}</span>
                            <span className="text-[10px] bg-indigo-50 text-indigo-700 font-semibold px-1.5 py-0.5 rounded border border-indigo-100">TopupNation</span>
                          </div>
                          <p className="text-xs text-neutral-400 font-mono mt-0.5">ID: {p.productId} • {p.skus?.length || 0} packages</p>
                        </div>
                        {isEnabled ? (
                          <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                            ✓ Bot Active
                          </span>
                        ) : (
                          <span className="text-[11px] font-medium text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                            Disabled
                          </span>
                        )}
                      </div>

                      <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 text-xs text-neutral-700 space-y-1 mb-3">
                        <div className="flex justify-between items-center">
                          <span className="font-medium text-neutral-500">Short Key:</span>
                          <span className="font-mono font-bold text-neutral-900">.{activeKey || `t${p.productId.slice(0, 4)}`}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="font-medium text-neutral-500">View Products:</span>
                          <span className="font-mono text-neutral-700">.{activeKey || `t${p.productId.slice(0, 4)}`}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="font-medium text-neutral-500">Order Format:</span>
                          <span className="font-mono text-neutral-700">.{activeKey || `t${p.productId.slice(0, 4)}`} &lt;PlayerID&gt; &lt;Product&gt;</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1 flex-1">
                          <span className="text-xs font-bold text-neutral-400">.</span>
                          <input
                            type="text"
                            placeholder="Custom Short Key (e.g. tp)"
                            value={currentInput}
                            onChange={(e) => {
                              const val = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '');
                              setTpnShortKeyInput(prev => ({ ...prev, [p.productId]: val }));
                            }}
                            className="w-full text-xs font-mono px-2 py-1 border border-neutral-300 rounded focus:ring-1 focus:ring-indigo-500 outline-none"
                          />
                        </div>
                        {isModified && (
                          <button
                            onClick={() => handleSaveTpnShortKey(p.productId)}
                            className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded transition-colors"
                          >
                            Save Key
                          </button>
                        )}
                      </div>
                    </div>

                    <button
                      onClick={() => handleToggleTpnProduct(p.productId, isEnabled)}
                      className={`w-full py-2 text-xs font-bold rounded-xl transition-colors border flex justify-center items-center gap-1.5 ${
                        isEnabled
                          ? 'bg-red-50 hover:bg-red-100 text-red-700 border-red-200'
                          : 'bg-indigo-600 hover:bg-indigo-700 text-white border-transparent'
                      }`}
                    >
                      {isEnabled ? 'Disable from Bot' : '✓ Enable for Bot'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Telegram Bot Games Management */}
        <div className="bg-white p-8 rounded-xl shadow-sm border border-neutral-200">
          <div className="flex justify-between items-center mb-2">
            <h2 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
              <span>🎮</span> Select Games for Telegram Bot
            </h2>
            {isConfigured && (
              <button 
                onClick={() => setRefreshKey(k => k + 1)}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>
                Refresh API
              </button>
            )}
          </div>
          <p className="text-sm text-neutral-500 mb-6">
            Choose which games from LootBar API should appear in your Telegram Bot. Only enabled games will be displayed in the bot's <span className="font-semibold text-neutral-700">🎮 Game List</span>.
          </p>

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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {games.map((game, i) => {
                const gameId = String(game.id || game.game_id);
                const gameName = game.name || game.game_name || 'Unknown';
                const savedMatch = savedGames.find(s => String(s.gameId) === gameId);
                const isEnabled = !!savedMatch;
                const activeKey = savedMatch?.shortKey || '';

                return (
                  <div 
                    key={i} 
                    className={`p-5 bg-white border-2 rounded-2xl transition-all flex flex-col justify-between ${
                      isEnabled 
                        ? 'border-emerald-500 shadow-md ring-1 ring-emerald-500/20' 
                        : 'border-neutral-200 hover:border-neutral-300 shadow-sm'
                    }`}
                  >
                    <div className="mb-4">
                      <div className="flex justify-between items-start gap-2 mb-2">
                        <span className="font-extrabold text-lg text-neutral-900 block leading-tight">{gameName}</span>
                        {isEnabled ? (
                          <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                            ✓ Bot Active
                          </span>
                        ) : (
                          <span className="text-[11px] font-medium text-neutral-500 bg-neutral-100 px-2 py-0.5 rounded-full whitespace-nowrap">
                            Disabled
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="inline-block px-2.5 py-0.5 bg-neutral-100 text-neutral-600 text-xs font-mono font-medium rounded">
                          ID: {gameId}
                        </span>
                        {isEnabled && activeKey && (
                          <span className="inline-block px-2.5 py-0.5 bg-blue-50 text-blue-700 border border-blue-200 text-xs font-mono font-bold rounded">
                            Key: .{activeKey}
                          </span>
                        )}
                      </div>
                    </div>

                    {isEnabled ? (
                      <div className="space-y-3">
                        <div className="p-3 bg-neutral-50 rounded-xl border border-neutral-200 text-xs text-neutral-700 space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="font-medium text-neutral-500">Short Key:</span>
                            <span className="font-mono font-bold text-neutral-900">.{activeKey}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="font-medium text-neutral-500">View Products:</span>
                            <span className="font-mono text-neutral-700">.{activeKey}</span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="font-medium text-neutral-500">Order Format:</span>
                            <span className="font-mono text-neutral-700">.{activeKey} &lt;UID&gt; &lt;Product&gt;</span>
                          </div>
                        </div>

                        <button 
                          onClick={() => deleteSavedGame(gameId)}
                          className="w-full py-2.5 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-bold rounded-xl transition-colors border border-red-200 flex justify-center items-center gap-2"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>
                          Remove from Bot
                        </button>
                      </div>
                    ) : (
                      <button 
                        onClick={() => saveGame(gameId, gameName)}
                        className="w-full py-2.5 bg-neutral-900 hover:bg-neutral-800 text-white text-sm font-bold rounded-xl transition-colors shadow-sm flex justify-center items-center gap-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="16"></line><line x1="8" y1="12" x2="16" y2="12"></line></svg>
                        Enable for Bot
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Active Games in Telegram Bot & Short Key Settings */}
        <div className="bg-white p-8 rounded-xl shadow-sm border border-neutral-200">
          <div className="flex justify-between items-center mb-4">
            <div>
              <h2 className="text-lg font-bold text-neutral-900">Current Active Games & Short Keys ({savedGames.length})</h2>
              <p className="text-sm text-neutral-500 mt-1">Set custom Short Keys so users can lookup products and order via <span className="font-mono text-neutral-700">.&lt;shortKey&gt;</span> in the Telegram Bot</p>
            </div>
          </div>
          
          {loadingSaved ? (
            <p className="text-neutral-500 py-4 text-center">Loading active games...</p>
          ) : savedGames.length === 0 ? (
            <div className="text-center py-10 bg-amber-50 rounded-xl border border-amber-200">
              <p className="text-amber-800 font-medium">No games specifically selected yet.</p>
              <p className="text-xs text-amber-600 mt-1">Click "Enable for Bot" on any game above to show it in the bot.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {savedGames.map((saved, i) => {
                const currentKey = shortKeyInputs[saved.gameId] !== undefined ? shortKeyInputs[saved.gameId] : (saved.shortKey || '');
                const isDirty = currentKey !== (saved.shortKey || '');

                return (
                  <div key={i} className="p-5 bg-emerald-50/30 border border-emerald-200 shadow-sm rounded-2xl flex flex-col justify-between">
                    <div>
                      <div className="flex justify-between items-start mb-3">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                          <span className="font-bold text-neutral-900 text-base">{saved.name}</span>
                        </div>
                        <span className="text-[11px] font-mono font-medium text-neutral-500 bg-white border border-neutral-200 px-2 py-0.5 rounded">
                          ID: {saved.gameId}
                        </span>
                      </div>

                      {/* Custom Short Key Input */}
                      <div className="mt-3 p-3 bg-white rounded-xl border border-neutral-200 space-y-2">
                        <label className="block text-xs font-semibold text-neutral-700">
                          Owner-Defined Short Key:
                        </label>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm font-bold text-neutral-400">.</span>
                          <input 
                            type="text"
                            value={currentKey}
                            onChange={(e) => setShortKeyInputs(prev => ({ ...prev, [saved.gameId]: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') }))}
                            placeholder="e.g. p, ml, ff"
                            className="flex-1 px-3 py-1.5 border border-neutral-300 rounded-lg text-sm font-mono font-bold text-neutral-900 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                          <button
                            disabled={!isDirty || savingKeyId === saved.gameId}
                            onClick={() => updateGameShortKey(saved.gameId, currentKey)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                              isDirty 
                                ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm' 
                                : 'bg-neutral-100 text-neutral-400 cursor-not-allowed'
                            }`}
                          >
                            {savingKeyId === saved.gameId ? 'Saving...' : 'Save Key'}
                          </button>
                        </div>

                        {/* Live Telegram Bot Commands Preview */}
                        <div className="pt-2 mt-2 border-t border-neutral-100 text-[11px] text-neutral-600 space-y-1 font-mono">
                          <div>
                            <span className="text-neutral-400">View packages:</span> <span className="font-bold text-blue-600">.{currentKey || 'key'}</span>
                          </div>
                          <div>
                            <span className="text-neutral-400">Direct order:</span> <span className="font-bold text-emerald-700">.{currentKey || 'key'} &lt;UID&gt; &lt;Product&gt;</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-emerald-100 flex justify-end">
                      <button 
                        onClick={() => deleteSavedGame(saved.gameId)}
                        className="text-red-600 hover:text-red-700 text-xs font-semibold px-3 py-1.5 rounded-lg hover:bg-red-50 transition-colors border border-red-200"
                      >
                        Remove from Bot
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Telegram User Management */}
        <div className="bg-white p-6 sm:p-8 rounded-xl shadow-sm border border-neutral-200">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-neutral-100">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
                  <span>👥</span> Telegram User Management
                </h2>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  <span>⚡ API Balance Linking Ready</span>
                </div>
              </div>
              <p className="text-sm text-neutral-500 mt-1">
                Authorize bot users, link selected resellers directly to live API balance, and manage wallet credits
              </p>
            </div>
            
            <div className="flex items-center gap-3">
              {lootbarBalance && (
                <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs font-medium text-emerald-800">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>Live LootBar API Balance:</span>
                  <span className="font-bold font-mono text-emerald-900">${lootbarBalance.total_amount || lootbarBalance.balance || '0.00'}</span>
                </div>
              )}
              <button 
                onClick={fetchTelegramUsers}
                className="text-xs font-semibold px-3 py-1.5 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-lg transition-colors flex items-center gap-1.5"
              >
                <span>🔄</span> Refresh Users
              </button>
            </div>
          </div>

          {/* Quick Add & Filter Controls */}
          <div className="mt-6 space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1 flex gap-2">
                <input 
                  type="text" 
                  placeholder="Enter Telegram Chat ID to authorize..."
                  value={newChatId}
                  onChange={e => setNewChatId(e.target.value)}
                  className="flex-1 px-3.5 py-2 text-sm border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
                <button 
                  onClick={() => handleAuthUser(newChatId)}
                  disabled={!newChatId}
                  className="px-4 py-2 bg-neutral-900 hover:bg-neutral-800 disabled:bg-neutral-300 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
                >
                  + Authorize User
                </button>
              </div>

              <div className="sm:w-64">
                <input 
                  type="text" 
                  placeholder="🔍 Search by ID, username, notes..."
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
            </div>

            {/* Filter Tabs */}
            {(() => {
              const apiUsersCount = telegramUsers.filter(u => u.useDirectApiBalance || u.balanceMode === 'api').length;
              const walletUsersCount = telegramUsers.filter(u => !u.useDirectApiBalance && u.balanceMode !== 'api').length;
              const pendingCount = telegramUsers.filter(u => !u.isAuthorized).length;

              return (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-neutral-100 text-xs">
                  <span className="text-neutral-400 font-medium mr-1">Filter:</span>
                  <button
                    onClick={() => setUserFilter('ALL')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                      userFilter === 'ALL'
                        ? 'bg-neutral-900 text-white shadow-sm'
                        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
                    }`}
                  >
                    All Users ({telegramUsers.length})
                  </button>
                  <button
                    onClick={() => setUserFilter('API')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-all flex items-center gap-1 ${
                      userFilter === 'API'
                        ? 'bg-emerald-600 text-white shadow-sm'
                        : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border border-emerald-200'
                    }`}
                  >
                    <span>⚡</span> API Linked ({apiUsersCount})
                  </button>
                  <button
                    onClick={() => setUserFilter('WALLET')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                      userFilter === 'WALLET'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200'
                    }`}
                  >
                    💳 Wallet Users ({walletUsersCount})
                  </button>
                  <button
                    onClick={() => setUserFilter('PENDING')}
                    className={`px-3 py-1.5 rounded-lg font-medium transition-all ${
                      userFilter === 'PENDING'
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200'
                    }`}
                  >
                    ⏳ Pending Approval ({pendingCount})
                  </button>
                </div>
              );
            })()}
          </div>
          
          {loadingUsers ? (
            <div className="text-center py-12">
              <div className="inline-block w-6 h-6 border-2 border-neutral-300 border-t-neutral-900 rounded-full animate-spin"></div>
              <p className="text-sm text-neutral-500 mt-2">Loading telegram users...</p>
            </div>
          ) : telegramUsers.length === 0 ? (
            <div className="text-center py-12 bg-neutral-50 rounded-xl border border-neutral-200 border-dashed mt-6">
              <p className="text-neutral-500 font-medium">No Telegram users found.</p>
              <p className="text-xs text-neutral-400 mt-1">Users will appear here automatically when they send /start to your bot.</p>
            </div>
          ) : (
            <div className="mt-6 space-y-3.5">
              {telegramUsers
                .filter(u => {
                  if (userFilter === 'API') return u.useDirectApiBalance || u.balanceMode === 'api';
                  if (userFilter === 'WALLET') return !u.useDirectApiBalance && u.balanceMode !== 'api';
                  if (userFilter === 'PENDING') return !u.isAuthorized;
                  return true;
                })
                .filter(u => {
                  if (!userSearch.trim()) return true;
                  const query = userSearch.toLowerCase();
                  const chatIdStr = String(u.telegramChatId || '');
                  const usernameStr = (u.username || '').toLowerCase();
                  const firstNameStr = (u.firstName || '').toLowerCase();
                  const notesStr = (u.notes || '').toLowerCase();
                  return chatIdStr.includes(query) || usernameStr.includes(query) || firstNameStr.includes(query) || notesStr.includes(query);
                })
                .map((user, i) => {
                  const isApiLinked = user.useDirectApiBalance || user.balanceMode === 'api';
                  const currentNote = editingNotes[user.telegramChatId] !== undefined ? editingNotes[user.telegramChatId] : (user.notes || '');

                  return (
                    <div 
                      key={user.telegramChatId || i} 
                      className={`p-5 rounded-xl border transition-all ${
                        isApiLinked 
                          ? 'bg-gradient-to-r from-emerald-50/70 to-teal-50/40 border-emerald-300 shadow-sm' 
                          : 'bg-white border-neutral-200 shadow-sm hover:border-neutral-300'
                      }`}
                    >
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        {/* User identity & tier information */}
                        <div className="flex-1 space-y-2.5">
                          <div className="flex flex-wrap items-center gap-2.5">
                            <span className="font-bold text-neutral-900 text-base font-mono">
                              Chat ID: {user.telegramChatId}
                            </span>
                            {user.username && (
                              <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-0.5 rounded-full border border-blue-200">
                                @{user.username}
                              </span>
                            )}
                            {user.firstName && (
                              <span className="text-xs text-neutral-600 bg-neutral-100 px-2 py-0.5 rounded-md">
                                {user.firstName}
                              </span>
                            )}
                            
                            {user.isAuthorized ? (
                              <span className="text-xs font-semibold text-emerald-700 bg-emerald-100/70 px-2 py-0.5 rounded-full border border-emerald-200">
                                ✅ Authorized
                              </span>
                            ) : (
                              <span className="text-xs font-semibold text-amber-700 bg-amber-100/80 px-2 py-0.5 rounded-full border border-amber-200">
                                ⏳ Pending Approval
                              </span>
                            )}

                            {user.receivesNotifications && (
                              <span className="text-[10px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200 uppercase tracking-wider">
                                🔔 Order Alerts
                              </span>
                            )}
                          </div>

                          {/* Balance Display & Mode Indicator */}
                          <div className="flex flex-wrap items-center gap-3">
                            {isApiLinked ? (
                              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-emerald-100/80 border border-emerald-300 rounded-lg text-emerald-900 shadow-xs">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                                <span className="text-xs font-bold uppercase tracking-wider">
                                  ⚡ API Linked ({user.apiProvider ? user.apiProvider.toUpperCase() : 'BOTH'})
                                </span>
                                <span className="text-xs text-emerald-700">| Direct Fulfillment</span>
                              </div>
                            ) : (
                              <div className="inline-flex items-baseline bg-neutral-50 px-3 py-1.5 rounded-lg border border-neutral-200">
                                <span className="text-xs text-neutral-500 mr-2 font-medium">Wallet Balance:</span>
                                <span className="text-xl font-extrabold text-neutral-900">${Number(user.balance || 0).toFixed(2)}</span>
                                <span className="text-[11px] text-neutral-400 ml-1">USD</span>
                              </div>
                            )}

                            {/* Optional Notes Pill */}
                            <div className="flex items-center gap-1.5 text-xs text-neutral-500">
                              <input
                                type="text"
                                placeholder="Add note (e.g. VIP Reseller, Agent)..."
                                value={currentNote}
                                onChange={(e) => setEditingNotes({ ...editingNotes, [user.telegramChatId]: e.target.value })}
                                className="px-2.5 py-1 text-xs border border-neutral-200 rounded-md bg-white/80 focus:bg-white focus:border-blue-500 outline-none w-48"
                              />
                              <button
                                onClick={() => handleSaveUserNotes(user.telegramChatId)}
                                disabled={savingNotesId === user.telegramChatId}
                                className="px-2 py-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded text-xs font-medium transition-colors disabled:opacity-50"
                                title="Save note"
                              >
                                {savingNotesId === user.telegramChatId ? '...' : 'Save'}
                              </button>
                            </div>
                          </div>
                        </div>
                        
                        {/* Action Buttons & Management */}
                        <div className="flex flex-col items-start lg:items-end gap-3 pt-3 lg:pt-0 border-t border-neutral-100 lg:border-t-0">
                          <div className="flex flex-wrap items-center gap-2">
                            {/* API Balance Mode Switcher */}
                            {isApiLinked ? (
                              <div className="flex items-center gap-1">
                                <select
                                  value={user.apiProvider || 'both'}
                                  onChange={(e) => handleToggleApiBalance(user.telegramChatId, false, e.target.value as any)}
                                  className="text-xs font-semibold px-2 py-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-emerald-800 outline-none cursor-pointer"
                                  title="Change linked API provider"
                                >
                                  <option value="both">🌐 Both APIs (Dual)</option>
                                  <option value="lootbar">🎮 LootBar Only</option>
                                  <option value="topupnation">🌐 TopupNation Only</option>
                                </select>
                                <button
                                  onClick={() => handleToggleApiBalance(user.telegramChatId, true)}
                                  disabled={togglingApiUser === user.telegramChatId}
                                  className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 transition-all shadow-xs disabled:opacity-50"
                                  title="Switch back to standard wallet balance mode"
                                >
                                  💳 Switch to Wallet
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => handleToggleApiBalance(user.telegramChatId, false, 'both')}
                                  disabled={togglingApiUser === user.telegramChatId}
                                  className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 transition-all flex items-center gap-1.5 shadow-xs disabled:opacity-50"
                                  title="Connect this user directly to Dual Live API balance"
                                >
                                  <span>⚡ Link API Balance</span>
                                </button>
                              </div>
                            )}

                            {/* Notification Alert Toggle */}
                            <button 
                              onClick={() => handleToggleNotifications(user.telegramChatId, user.receivesNotifications)}
                              className={`text-xs font-medium px-2.5 py-1.5 rounded-lg border transition-colors ${
                                user.receivesNotifications
                                  ? 'bg-neutral-100 border-neutral-300 text-neutral-700 hover:bg-neutral-200'
                                  : 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100'
                              }`}
                              title="Toggle sending live order notifications to this user"
                            >
                              {user.receivesNotifications ? '🔕 Mute Alerts' : '🔔 Send Alerts'}
                            </button>

                            {/* Authorization Toggle */}
                            <button 
                              onClick={() => user.isAuthorized ? handleUnauthUser(user.telegramChatId) : handleAuthUser(user.telegramChatId)}
                              className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors ${
                                user.isAuthorized 
                                  ? 'border-red-200 text-red-600 hover:bg-red-50' 
                                  : 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-600'
                              }`}
                            >
                              {user.isAuthorized ? 'Revoke Access' : 'Approve User'}
                            </button>

                            {/* Delete User */}
                            <button
                              onClick={() => handleDeleteUser(user.telegramChatId)}
                              className="text-xs text-neutral-400 hover:text-red-600 px-2 py-1.5 rounded-lg hover:bg-red-50 transition-colors"
                              title="Remove user completely"
                            >
                              🗑
                            </button>
                          </div>
                          
                          {/* Wallet Add / Deduct Controls (Only in Wallet Mode & Authorized) */}
                          {user.isAuthorized && !isApiLinked && (
                            <div className="flex items-center gap-2">
                              <span className="text-[11px] text-neutral-400">Adjust wallet:</span>
                              <div className="relative">
                                <span className="absolute left-2 top-1.5 text-xs text-neutral-400">$</span>
                                <input
                                  type="number"
                                  placeholder="0.00"
                                  value={balanceInput[user.telegramChatId] || ''}
                                  onChange={(e) => setBalanceInput({ ...balanceInput, [user.telegramChatId]: e.target.value })}
                                  className="w-24 pl-5 pr-2 py-1 text-xs border border-neutral-300 rounded-md outline-none focus:border-blue-500 font-mono"
                                />
                              </div>
                              <button
                                onClick={() => handleAddBalance(user.telegramChatId)}
                                disabled={!balanceInput[user.telegramChatId]}
                                className="text-xs bg-emerald-50 border border-emerald-300 hover:bg-emerald-100 text-emerald-800 font-semibold px-2.5 py-1 rounded-md transition-colors disabled:opacity-40"
                              >
                                + Add
                              </button>
                              <button
                                onClick={() => handleDeductBalance(user.telegramChatId)}
                                disabled={!balanceInput[user.telegramChatId]}
                                className="text-xs bg-rose-50 border border-rose-300 hover:bg-rose-100 text-rose-800 font-semibold px-2.5 py-1 rounded-md transition-colors disabled:opacity-40"
                              >
                                - Deduct
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>

        {/* Real-Time Top-Up Orders & Status Tracking System */}
        <div className="bg-white p-6 sm:p-8 rounded-xl shadow-sm border border-neutral-200">
          {/* Header & Controls */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-6 border-b border-neutral-100">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
                  <span>⚡</span> Real-Time Order Status Tracking
                </h2>
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 -ml-2.5"></span>
                  Live Auto-Sync Active
                </div>
              </div>
              <p className="text-sm text-neutral-500 mt-1">
                Real-time tracking of top-ups syncing automatically with LootBar & Game APIs
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={() => setIsAutoSyncing(!isAutoSyncing)}
                className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors flex items-center gap-1.5 ${
                  isAutoSyncing 
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100' 
                    : 'bg-neutral-50 border-neutral-200 text-neutral-600 hover:bg-neutral-100'
                }`}
                title="Toggle real-time auto sync polling"
              >
                <span className={`w-2 h-2 rounded-full ${isAutoSyncing ? 'bg-emerald-500 animate-pulse' : 'bg-neutral-400'}`}></span>
                {isAutoSyncing ? 'Auto-Polling (4s)' : 'Auto-Poll Paused'}
              </button>

              <button 
                onClick={() => fetchOrders(false)}
                disabled={loadingOrders}
                className="text-xs font-semibold px-3.5 py-1.5 bg-neutral-900 hover:bg-neutral-800 text-white rounded-lg transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
              >
                <svg className={`w-3.5 h-3.5 ${loadingOrders ? 'animate-spin' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Sync All Orders
              </button>
            </div>
          </div>

          {/* Quick Metrics Bar with API Provider Breakdown */}
          {(() => {
            const total = orders.length;
            const active = orders.filter(o => o.state === 0 || o.state === 1 || o.state === 4).length;
            const completed = orders.filter(o => o.state === 2).length;
            const totalVol = orders.reduce((sum, o) => sum + (o.price || 0), 0);
            const lbCount = orders.filter(o => o.provider !== 'topupnation' && o.extraInfo?.provider !== 'topupnation').length;
            const tpnCount = orders.filter(o => o.provider === 'topupnation' || o.extraInfo?.provider === 'topupnation').length;

            return (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 my-5">
                <div className="bg-neutral-50 p-3.5 rounded-xl border border-neutral-200">
                  <div className="text-xs text-neutral-500 font-medium">Total Orders</div>
                  <div className="text-xl font-bold text-neutral-900 mt-0.5">{total}</div>
                </div>
                <div className="bg-emerald-50/70 p-3.5 rounded-xl border border-emerald-200">
                  <div className="text-xs text-emerald-800 font-medium flex items-center gap-1">
                    <span>🎮</span> LootBar Orders
                  </div>
                  <div className="text-xl font-bold text-emerald-900 mt-0.5">{lbCount}</div>
                </div>
                <div className="bg-indigo-50/70 p-3.5 rounded-xl border border-indigo-200">
                  <div className="text-xs text-indigo-800 font-medium flex items-center gap-1">
                    <span>⚡</span> TopupNation Orders
                  </div>
                  <div className="text-xl font-bold text-indigo-900 mt-0.5">{tpnCount}</div>
                </div>
                <div className="bg-blue-50/60 p-3.5 rounded-xl border border-blue-100">
                  <div className="text-xs text-blue-700 font-medium flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping"></span>
                    Processing & Active
                  </div>
                  <div className="text-xl font-bold text-blue-900 mt-0.5">{active}</div>
                </div>
                <div className="bg-purple-50/60 p-3.5 rounded-xl border border-purple-100">
                  <div className="text-xs text-purple-700 font-medium">Total Order Volume</div>
                  <div className="text-xl font-bold text-purple-900 mt-0.5 font-mono">${totalVol.toFixed(2)}</div>
                </div>
              </div>
            );
          })()}

          {/* Filters & Search */}
          <div className="flex flex-col md:flex-row gap-3 justify-between items-stretch md:items-center mb-5">
            {/* Filter Tabs (API Provider & Status) */}
            <div className="flex flex-wrap items-center gap-2">
              {/* Provider Tabs */}
              <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-lg">
                <span className="text-[11px] font-bold text-neutral-400 px-2 uppercase tracking-wider">API:</span>
                <button
                  onClick={() => setOrderProviderFilter('ALL')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all ${
                    orderProviderFilter === 'ALL'
                      ? 'bg-neutral-900 text-white shadow-xs font-semibold'
                      : 'text-neutral-600 hover:text-neutral-900'
                  }`}
                >
                  🌐 All APIs ({orders.length})
                </button>
                <button
                  onClick={() => setOrderProviderFilter('LOOTBAR')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${
                    orderProviderFilter === 'LOOTBAR'
                      ? 'bg-emerald-700 text-white shadow-xs font-semibold'
                      : 'text-emerald-700 hover:bg-emerald-50'
                  }`}
                >
                  🎮 LootBar ({orders.filter(o => o.provider !== 'topupnation' && o.extraInfo?.provider !== 'topupnation').length})
                </button>
                <button
                  onClick={() => setOrderProviderFilter('TOPUPNATION')}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1 ${
                    orderProviderFilter === 'TOPUPNATION'
                      ? 'bg-indigo-700 text-white shadow-xs font-semibold'
                      : 'text-indigo-700 hover:bg-indigo-50'
                  }`}
                >
                  ⚡ TopupNation ({orders.filter(o => o.provider === 'topupnation' || o.extraInfo?.provider === 'topupnation').length})
                </button>
              </div>

              {/* Status Tabs */}
              <div className="flex items-center gap-1 bg-neutral-100 p-1 rounded-lg">
                {(['ALL', 'ACTIVE', 'COMPLETED', 'FAILED'] as const).map(tab => {
                  const count = tab === 'ALL' 
                    ? orders.length 
                    : tab === 'ACTIVE' 
                      ? orders.filter(o => o.state === 0 || o.state === 1 || o.state === 4).length
                      : tab === 'COMPLETED'
                        ? orders.filter(o => o.state === 2).length
                        : orders.filter(o => o.state === 3 || o.state === 6).length;

                  return (
                    <button
                      key={tab}
                      onClick={() => setOrderFilter(tab)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-all ${
                        orderFilter === tab 
                          ? 'bg-white text-neutral-900 shadow-xs font-semibold' 
                          : 'text-neutral-600 hover:text-neutral-900'
                      }`}
                    >
                      {tab === 'ALL' ? 'All Status' : tab === 'ACTIVE' ? '⏳ Active' : tab === 'COMPLETED' ? '✅ Completed' : '❌ Failed'} ({count})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Search Input */}
            <div className="relative max-w-xs w-full">
              <input
                type="text"
                placeholder="Search UID, IGN, SKU, Ref ID..."
                value={orderSearch}
                onChange={(e) => setOrderSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-neutral-50 border border-neutral-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white transition-all"
              />
              <svg className="w-3.5 h-3.5 absolute left-2.5 top-2 text-neutral-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              {orderSearch && (
                <button 
                  onClick={() => setOrderSearch('')}
                  className="absolute right-2.5 top-1.5 text-xs text-neutral-400 hover:text-neutral-600"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Orders Table */}
          {loadingOrders && orders.length === 0 ? (
            <div className="text-neutral-500 py-12 text-center flex flex-col items-center justify-center gap-2">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
              <p className="text-xs">Loading real-time orders...</p>
            </div>
          ) : orders.length === 0 ? (
            <div className="text-center py-12 bg-neutral-50 rounded-xl border border-neutral-200 border-dashed">
              <p className="text-neutral-600 font-medium">No orders recorded yet.</p>
              <p className="text-xs text-neutral-400 mt-1">When users place top-up orders through the Telegram Bot, live records will appear here.</p>
            </div>
          ) : (() => {
            const filteredOrders = orders.filter(o => {
              // Provider Filter
              const isTpn = o.provider === 'topupnation' || o.extraInfo?.provider === 'topupnation';
              if (orderProviderFilter === 'LOOTBAR' && isTpn) return false;
              if (orderProviderFilter === 'TOPUPNATION' && !isTpn) return false;

              // Status Filter
              if (orderFilter === 'ACTIVE' && !(o.state === 0 || o.state === 1 || o.state === 4)) return false;
              if (orderFilter === 'COMPLETED' && o.state !== 2) return false;
              if (orderFilter === 'FAILED' && !(o.state === 3 || o.state === 6)) return false;

              // Search Filter
              if (orderSearch.trim()) {
                const query = orderSearch.toLowerCase().trim();
                const cleanQuery = query.replace(/^@/, '');
                const matchName = o.gameName?.toLowerCase().includes(query);
                const matchSku = o.skuName?.toLowerCase().includes(query);
                const matchPlayer = o.playerName?.toLowerCase().includes(query);
                const matchRef = o.referenceId?.toLowerCase().includes(query);
                const matchOrder = o.orderId?.toLowerCase().includes(query);
                const matchChat = String(o.telegramChatId).includes(query);
                const matchUsername = o.telegramUsername?.toLowerCase().includes(cleanQuery);
                const matchFirstName = o.telegramFirstName?.toLowerCase().includes(cleanQuery);
                const matchExtra = o.extraInfo ? JSON.stringify(o.extraInfo).toLowerCase().includes(query) : false;

                return matchName || matchSku || matchPlayer || matchRef || matchOrder || matchChat || matchUsername || matchFirstName || matchExtra;
              }
              return true;
            });

            if (filteredOrders.length === 0) {
              return (
                <div className="text-center py-8 bg-neutral-50 rounded-xl border border-neutral-200">
                  <p className="text-xs text-neutral-500">No orders match the selected filter & search criteria.</p>
                </div>
              );
            }

            return (
              <div className="overflow-x-auto border border-neutral-200 rounded-xl">
                <table className="w-full text-left text-sm border-collapse">
                  <thead>
                    <tr className="border-b border-neutral-200 bg-neutral-50/80 text-neutral-600 font-medium text-xs">
                      <th className="py-3 px-4">Date / Time</th>
                      <th className="py-3 px-4">Provider</th>
                      <th className="py-3 px-4">User</th>
                      <th className="py-3 px-4">Game & Product</th>
                      <th className="py-3 px-4">Player Name</th>
                      <th className="py-3 px-4">Account UID</th>
                      <th className="py-3 px-4">Price</th>
                      <th className="py-3 px-4">Live Status Pipeline</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 bg-white">
                    {filteredOrders.map((o) => {
                      const status = getOrderStateDetails(o.state);
                      const isSyncingThis = syncingRefId === o.referenceId;
                      const provider = o.provider || 'lootbar';

                      return (
                        <tr key={o.referenceId} className="hover:bg-neutral-50/70 transition-colors">
                          {/* Date */}
                          <td className="py-3.5 px-4 text-xs text-neutral-500 whitespace-nowrap">
                            <div className="font-medium text-neutral-700">{formatMyanmarDate(o.createdAt)}</div>
                            <div className="text-[11px] text-neutral-400">{formatMyanmarTime(o.createdAt)}</div>
                          </td>

                          {/* Provider */}
                          <td className="py-3.5 px-4 whitespace-nowrap">
                            {provider === 'topupnation' ? (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-md">
                                🌐 TopupNation
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                                🟢 LootBar
                              </span>
                            )}
                          </td>

                          {/* User */}
                          <td className="py-3.5 px-4">
                            {(() => {
                              const matchedUser = telegramUsers.find(u => String(u.telegramChatId) === String(o.telegramChatId));
                              const isApi = !!(matchedUser?.useDirectApiBalance || matchedUser?.balanceMode === 'api');
                              const username = o.telegramUsername || matchedUser?.username;
                              const firstName = o.telegramFirstName || matchedUser?.firstName;

                              return (
                                <div className="space-y-0.5">
                                  {username ? (
                                    <button
                                      onClick={() => setOrderSearch(`@${username}`)}
                                      className="font-medium text-xs text-blue-700 hover:text-blue-900 hover:underline flex items-center gap-1 group"
                                      title="Filter by @username"
                                    >
                                      <span className="font-semibold text-neutral-900 group-hover:text-blue-800">@{username}</span>
                                    </button>
                                  ) : firstName ? (
                                    <div className="font-medium text-xs text-neutral-800">{firstName}</div>
                                  ) : null}

                                  <div className="flex items-center gap-1">
                                    <button
                                      onClick={() => setOrderSearch(String(o.telegramChatId))}
                                      className="font-mono text-[11px] text-neutral-500 hover:text-neutral-800 hover:underline"
                                      title="Filter by Chat ID"
                                    >
                                      ID: {o.telegramChatId}
                                    </button>
                                  </div>

                                  {matchedUser?.notes ? (
                                    <div className="text-[11px] text-neutral-600 truncate max-w-[130px] font-medium" title={matchedUser.notes}>
                                      📝 {matchedUser.notes}
                                    </div>
                                  ) : null}

                                  {isApi && (
                                    <span className="inline-block mt-0.5 text-[9px] font-bold text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.2 rounded">
                                      VIP API
                                    </span>
                                  )}
                                </div>
                              );
                            })()}
                          </td>

                          {/* Game & Product */}
                          <td className="py-3.5 px-4">
                            <span className="font-semibold text-neutral-900 block">{o.skuName || `Product #${o.skuId}`}</span>
                            <span className="text-xs text-neutral-500 font-medium">{o.gameName || `Game #${o.gameId}`}</span>
                          </td>

                          {/* Player Name */}
                          <td className="py-3.5 px-4">
                            {o.playerName && String(o.playerName).toLowerCase() !== 'undefined' && String(o.playerName).toLowerCase() !== 'null' ? (
                              <span className="inline-flex items-center gap-1 font-semibold text-xs text-blue-800 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                                🎯 {o.playerName}
                              </span>
                            ) : (
                              <span className="text-xs text-neutral-400 italic">-</span>
                            )}
                          </td>

                          {/* Account UID & Details */}
                          <td className="py-3.5 px-4 text-xs">
                            {o.extraInfo ? (
                              <div className="space-y-0.5 max-w-[180px]">
                                {Object.entries(o.extraInfo)
                                  .filter(([k, v]) => k !== 'paymentSource' && k !== 'provider' && v && String(v).trim() && String(v).toLowerCase() !== 'undefined' && String(v).toLowerCase() !== 'null')
                                  .map(([k, v]) => (
                                    <div key={k} className="truncate">
                                      <span className="text-neutral-400 font-medium uppercase text-[10px]">{k}:</span>{' '}
                                      <span className="font-mono font-medium text-neutral-800">{String(v)}</span>
                                    </div>
                                  ))}
                              </div>
                            ) : '-'}
                          </td>

                          {/* Price */}
                          <td className="py-3.5 px-4 font-bold text-neutral-900 font-mono text-xs">
                            ${Number(o.price || 0).toFixed(2)}
                          </td>

                          {/* Live Status Tracking Stepper */}
                          <td className="py-3.5 px-4">
                            <div className="flex flex-col gap-1.5 min-w-[160px]">
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${status.badgeBg}`}>
                                  <span className={`w-1.5 h-1.5 rounded-full ${status.dotBg}`}></span>
                                  {status.label}
                                </span>
                              </div>

                              {/* 3-Step Mini Visual Progress Bar */}
                              <div className="flex items-center gap-1 w-full max-w-[140px]">
                                <div className={`h-1.5 flex-1 rounded-full ${status.step >= 1 ? (o.state === 3 ? 'bg-rose-400' : 'bg-amber-400') : 'bg-neutral-200'}`} title="Step 1: Pending"></div>
                                <div className={`h-1.5 flex-1 rounded-full ${status.step >= 2 ? (o.state === 3 ? 'bg-rose-400' : o.state === 2 ? 'bg-emerald-500' : 'bg-blue-500 animate-pulse') : 'bg-neutral-200'}`} title="Step 2: Processing"></div>
                                <div className={`h-1.5 flex-1 rounded-full ${status.step >= 3 ? (o.state === 3 ? 'bg-rose-500' : 'bg-emerald-500') : 'bg-neutral-200'}`} title="Step 3: Completed"></div>
                              </div>
                            </div>
                          </td>

                          {/* Actions */}
                          <td className="py-3.5 px-4 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => handleSyncOrder(o.referenceId)}
                                disabled={isSyncingThis}
                                className="text-xs font-medium px-2.5 py-1 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 rounded-md border border-neutral-200 transition-colors flex items-center gap-1 disabled:opacity-50"
                                title="Check status with LootBar API right now"
                              >
                                <svg className={`w-3 h-3 ${isSyncingThis ? 'animate-spin text-blue-600' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                </svg>
                                {isSyncingThis ? 'Syncing...' : 'Sync'}
                              </button>

                              <button
                                onClick={() => setSelectedTrackingOrder(o)}
                                className="text-xs font-medium px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-md border border-blue-200 transition-colors"
                              >
                                View Tracker
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>

        {/* Real-Time Order Tracking Modal Drawer */}
        {selectedTrackingOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-neutral-900/60 backdrop-blur-xs animate-in fade-in duration-150">
            <div className="bg-white rounded-2xl max-w-xl w-full p-6 sm:p-8 shadow-2xl border border-neutral-200 relative animate-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
              <button
                onClick={() => setSelectedTrackingOrder(null)}
                className="absolute top-5 right-5 text-neutral-400 hover:text-neutral-700 p-1.5 rounded-full hover:bg-neutral-100 transition-colors"
              >
                <svg className="w-5 h-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl">📡</span>
                <h3 className="text-lg font-bold text-neutral-900">Live Order Status Tracker</h3>
              </div>
              <p className="text-xs text-neutral-500 mb-6">
                Reference ID: <span className="font-mono font-medium text-neutral-800">{selectedTrackingOrder.referenceId}</span>
              </p>

              {/* 3-Stage Progress Timeline */}
              {(() => {
                const status = getOrderStateDetails(selectedTrackingOrder.state);
                const step = status.step;
                const isFailed = selectedTrackingOrder.state === 3 || selectedTrackingOrder.state === 6;

                return (
                  <div className="bg-neutral-50 p-5 rounded-xl border border-neutral-200 mb-6">
                    <div className="text-xs font-semibold uppercase text-neutral-500 mb-4 tracking-wider">
                      Fulfillment Lifecycle
                    </div>

                    <div className="relative flex justify-between items-center">
                      {/* Connecting line */}
                      <div className="absolute top-4 left-6 right-6 h-1 bg-neutral-200 -z-0">
                        <div 
                          className={`h-full transition-all duration-500 ${
                            isFailed ? 'bg-rose-400' : 'bg-emerald-500'
                          }`}
                          style={{ width: step === 1 ? '0%' : step === 2 ? '50%' : '100%' }}
                        ></div>
                      </div>

                      {/* Stage 1: Order Received / Pending */}
                      <div className="flex flex-col items-center text-center z-10">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-xs ${
                          step >= 1 ? 'bg-amber-500 text-white' : 'bg-neutral-200 text-neutral-600'
                        }`}>
                          ✓
                        </div>
                        <span className="text-xs font-semibold text-neutral-800 mt-2">1. Pending</span>
                        <span className="text-[10px] text-neutral-500">Order Initiated</span>
                      </div>

                      {/* Stage 2: Processing with Game API */}
                      <div className="flex flex-col items-center text-center z-10">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-xs ${
                          step === 2 
                            ? 'bg-blue-600 text-white animate-pulse ring-4 ring-blue-100' 
                            : step > 2 
                              ? isFailed ? 'bg-rose-500 text-white' : 'bg-emerald-500 text-white'
                              : 'bg-neutral-200 text-neutral-600'
                        }`}>
                          {step === 2 ? '⚡' : step > 2 ? '✓' : '2'}
                        </div>
                        <span className="text-xs font-semibold text-neutral-800 mt-2">2. Processing</span>
                        <span className="text-[10px] text-neutral-500">Game Server Sync</span>
                      </div>

                      {/* Stage 3: Completed / Success */}
                      <div className="flex flex-col items-center text-center z-10">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shadow-xs ${
                          step >= 3 
                            ? isFailed ? 'bg-rose-500 text-white' : 'bg-emerald-600 text-white' 
                            : 'bg-neutral-200 text-neutral-600'
                        }`}>
                          {isFailed ? '✕' : step >= 3 ? '✓' : '3'}
                        </div>
                        <span className="text-xs font-semibold text-neutral-800 mt-2">
                          {isFailed ? '3. Failed' : '3. Completed'}
                        </span>
                        <span className="text-[10px] text-neutral-500">
                          {isFailed ? 'Refunded' : 'Delivered'}
                        </span>
                      </div>
                    </div>

                    <div className="mt-5 pt-3 border-t border-neutral-200 text-center">
                      <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${status.badgeBg}`}>
                        <span>{status.icon}</span>
                        <span>Current Status: {status.label}</span>
                      </div>
                      <p className="text-xs text-neutral-500 mt-1.5">{status.description}</p>
                    </div>
                  </div>
                );
              })()}

              {/* Order Full Breakdown Details */}
              <div className="space-y-3 text-xs mb-6">
                <div className="bg-neutral-50 p-4 rounded-xl border border-neutral-200 space-y-2">
                  <div className="flex justify-between py-1 border-b border-neutral-200/60">
                    <span className="text-neutral-500">Game Name:</span>
                    <span className="font-semibold text-neutral-900">{selectedTrackingOrder.gameName || selectedTrackingOrder.gameId}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-200/60">
                    <span className="text-neutral-500">Product Package:</span>
                    <span className="font-semibold text-neutral-900">{selectedTrackingOrder.skuName || selectedTrackingOrder.skuId}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-200/60">
                    <span className="text-neutral-500">Player Name (IGN):</span>
                    <span className="font-semibold text-blue-700">{selectedTrackingOrder.playerName || 'Not recorded'}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-200/60">
                    <span className="text-neutral-500">Top-Up Amount Paid:</span>
                    <span className="font-bold text-neutral-900 font-mono">${Number(selectedTrackingOrder.price || 0).toFixed(2)} USD</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-neutral-200/60">
                    <span className="text-neutral-500">Telegram Chat ID:</span>
                    <span className="font-mono text-neutral-800">{selectedTrackingOrder.telegramChatId}</span>
                  </div>
                  {selectedTrackingOrder.orderId && (
                    <div className="flex justify-between py-1 border-b border-neutral-200/60">
                      <span className="text-neutral-500">LootBar Order ID:</span>
                      <span className="font-mono font-medium text-neutral-800">{selectedTrackingOrder.orderId}</span>
                    </div>
                  )}
                  {selectedTrackingOrder.extraInfo && Object.entries(selectedTrackingOrder.extraInfo).map(([k, v]) => (
                    <div key={k} className="flex justify-between py-1 border-b border-neutral-200/60">
                      <span className="text-neutral-500 uppercase">{k}:</span>
                      <span className="font-mono font-semibold text-neutral-800">{String(v)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-1">
                    <span className="text-neutral-500">Created At:</span>
                    <span className="text-neutral-700 font-medium">{formatMyanmarDateTime(selectedTrackingOrder.createdAt)}</span>
                  </div>
                </div>
              </div>

              {/* Bottom Buttons */}
              <div className="flex items-center justify-end gap-3">
                <button
                  onClick={() => handleSyncOrder(selectedTrackingOrder.referenceId)}
                  disabled={syncingRefId === selectedTrackingOrder.referenceId}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg transition-colors flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                >
                  <svg className={`w-3.5 h-3.5 ${syncingRefId === selectedTrackingOrder.referenceId ? 'animate-spin' : ''}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {syncingRefId === selectedTrackingOrder.referenceId ? 'Checking API...' : 'Sync Status with API'}
                </button>
                <button
                  onClick={() => setSelectedTrackingOrder(null)}
                  className="px-4 py-2 bg-neutral-100 hover:bg-neutral-200 text-neutral-700 text-xs font-semibold rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
