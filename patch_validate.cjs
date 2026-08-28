const fs = require('fs');

const tpnClientPath = 'server/providers/topupnation/TopupNationClient.ts';
let tpnClient = fs.readFileSync(tpnClientPath, 'utf8');

const validateMethod = `  /**
   * GET /api/v1/reseller/products/:productId/validate
   * Validates user account and returns role/player name.
   */
  public async validateUser(productId: string, userAccount: string, server?: string): Promise<{ success: boolean; role?: string; error?: string }> {
    try {
      const queryParams = new URLSearchParams();
      queryParams.append('userAccount', userAccount);
      if (server) {
        queryParams.append('server', server);
      }
      const res = await this.request<any>('GET', \`/api/v1/reseller/products/\${encodeURIComponent(productId)}/validate?\${queryParams.toString()}\`);
      const data = res?.data || res;
      const role = data?.role || data?.roleName || data?.playerName || data?.name;
      if (role) {
        return { success: true, role: String(role) };
      }
      return { success: false, error: 'Validation returned success but no role was found.' };
    } catch (error: any) {
      return { success: false, error: error.message || 'Validation failed' };
    }
  }

`;

if (!tpnClient.includes('validateUser(')) {
  tpnClient = tpnClient.replace(
    "public async getWalletBalance(): Promise<TopupNationWalletBalance> {",
    validateMethod + "  public async getWalletBalance(): Promise<TopupNationWalletBalance> {"
  );
  fs.writeFileSync(tpnClientPath, tpnClient);
  console.log("Patched TopupNationClient");
}

const tpnServicePath = 'server/providers/topupnation/TopupNationService.ts';
let tpnService = fs.readFileSync(tpnServicePath, 'utf8');

const checkRoleMethod = `
  public async checkRole(productId: string, extraInfo: Record<string, string>): Promise<{ success: boolean; playerName?: string; error?: string }> {
    try {
      let userAccount = '';
      let server = '';
      for (const [key, val] of Object.entries(extraInfo)) {
        if (!val) continue;
        const lk = key.toLowerCase();
        if (!userAccount && (lk === 'uid' || lk === 'userid' || lk === 'user_id' || lk === 'player_id' || lk === 'account_id' || lk === 'useraccount')) {
          userAccount = String(val).trim();
        } else if (!server && (lk === 'zoneid' || lk === 'zone_id' || lk === 'server' || lk === 'server_id' || lk === 'serverid')) {
          server = String(val).trim();
        }
      }
      if (!userAccount) {
        return { success: false, error: 'User Account ID missing' };
      }
      const valRes = await this.client.validateUser(productId, userAccount, server);
      if (valRes.success && valRes.role) {
        return { success: true, playerName: valRes.role };
      }
      return { success: false, error: valRes.error || 'Player validation failed' };
    } catch (e: any) {
      return { success: false, error: e.message };
    }
  }
`;

if (!tpnService.includes('checkRole(')) {
  tpnService = tpnService.replace(
    "public async syncCatalog",
    checkRoleMethod + "\n  public async syncCatalog"
  );
  fs.writeFileSync(tpnServicePath, tpnService);
  console.log("Patched TopupNationService");
}

