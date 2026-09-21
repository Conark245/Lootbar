import re

with open('server.ts', 'r', encoding='utf-8') as f:
    content = f.read()

old_test = """    if (apiKey) {
        g2bulkClient.updateCredentials({ apiKey });
        const testRes = await g2bulkClient.getBalance();
        if (!testRes.success) {
             return res.json({ success: false, error: 'Invalid API Key or API error' });
        }
    }"""

new_test = """    if (apiKey) {
        g2bulkClient.updateCredentials({ apiKey });
        try {
            await g2bulkClient.getBalance();
        } catch (e: any) {
             return res.json({ success: false, error: 'Invalid API Key or API error: ' + e.message });
        }
    }"""

content = content.replace(old_test, new_test)

with open('server.ts', 'w', encoding='utf-8') as f:
    f.write(content)
