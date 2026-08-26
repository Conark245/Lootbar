import fs from 'fs';

let bot = fs.readFileSync('server/bot.ts', 'utf8');

// Replace local helper functions with imports
// First, insert imports at the top
if (!bot.includes("from './bot/helpers'")) {
  bot = bot.replace(
    "import { TopupRequest } from './models/TopupRequest';",
    "import { TopupRequest } from './models/TopupRequest';\nimport { escapeMd, escapeCode, formatMyanmarDateTime, formatMyanmarTimeOnly, safeReply, safeSendMessage, safeEditMessageText, safeSendPhoto, safeEditMessageCaption, getAdminChatId, parseCommandArgs } from './bot/helpers';\nimport { findLootBarSkuMatch, findTopupNationSkuMatch } from './bot/matching';"
  );
}

// Remove local implementations
const toRemove = [
  // Helpers
  /export function escapeMd[\s\S]*?(?=export function escapeCode)/,
  /export function escapeCode[\s\S]*?(?=export function formatMyanmarDateTime)/,
  /export function formatMyanmarDateTime[\s\S]*?(?=export function formatMyanmarTimeOnly)/,
  /export function formatMyanmarTimeOnly[\s\S]*?(?=export async function safeReply)/,
  /export async function safeReply[\s\S]*?(?=export async function safeSendMessage)/,
  /export async function safeSendMessage[\s\S]*?(?=export async function safeEditMessageText)/,
  /export async function safeEditMessageText[\s\S]*?(?=export async function safeSendPhoto)/,
  /export async function safeSendPhoto[\s\S]*?(?=export async function safeEditMessageCaption)/,
  /export async function safeEditMessageCaption[\s\S]*?(?=async function getAdminChatId)/,
  // getAdminChatId is a bit tricky because it expects getData closure. I'll leave it in bot.ts for now
  // and remove parseCommandArgs
  /function parseCommandArgs[\s\S]*?(?=function findLootBarSkuMatch)/,
  /function findLootBarSkuMatch[\s\S]*?(?=function findTopupNationSkuMatch)/,
  /function findTopupNationSkuMatch[\s\S]*?(?=export function setupBot)/
];

for (const regex of toRemove) {
  bot = bot.replace(regex, '');
}

fs.writeFileSync('server/bot.ts', bot);
console.log("bot.ts updated to use helpers and matching");
