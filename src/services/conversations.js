const fs = require('fs');
const fsp = require('fs').promises;
const readline = require('readline');
const path = require('path');

const CLAUDE_DIR = process.env.CLAUDE_DATA_DIR || path.join(require('os').homedir(), '.claude');
const HISTORY_FILE = path.join(CLAUDE_DIR, 'history.jsonl');
const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

async function parseJsonl(filePath) {
  try {
    const content = await fsp.readFile(filePath, 'utf-8');
    return content.trim().split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); }
      catch { return null; }
    }).filter(Boolean);
  } catch {
    return [];
  }
}

function validateParam(name, value) {
  if (name === 'projectDir') {
    if (!value || !/^[a-zA-Z0-9_-]+$/.test(value)) {
      const err = new Error('Invalid projectDir: must contain only alphanumeric characters, hyphens, and underscores');
      err.isValidation = true;
      throw err;
    }
  } else if (name === 'sessionId') {
    if (!value || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value)) {
      const err = new Error('Invalid sessionId: must be a valid UUID v4 format');
      err.isValidation = true;
      throw err;
    }
  }
}

function encodeProject(projectPath) {
  // /home/marco → -home-marco
  return projectPath.replace(/\//g, '-');
}

function getConversationFilePath(projectDir, sessionId) {
  validateParam('projectDir', projectDir);
  validateParam('sessionId', sessionId);
  const filePath = path.join(PROJECTS_DIR, projectDir, `${sessionId}.jsonl`);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(PROJECTS_DIR))) {
    const err = new Error('Path traversal detected: resolved path is outside projects directory');
    err.isValidation = true;
    throw err;
  }
  return filePath;
}

async function getFileSize(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    return stat.size;
  } catch {
    return 0;
  }
}

async function getProjects() {
  try {
    const entries = await fsp.readdir(PROJECTS_DIR);
    const results = [];
    for (const d of entries) {
      const fullPath = path.join(PROJECTS_DIR, d);
      const stat = await fsp.stat(fullPath);
      if (stat.isDirectory()) {
        results.push(d);
      }
    }
    return results;
  } catch {
    return [];
  }
}

async function listConversations({ search, project, page = 1, limit = 50 } = {}) {
  const history = await parseJsonl(HISTORY_FILE);

  // Deduplicate by sessionId — keep latest timestamp
  const bySession = new Map();
  for (const entry of history) {
    const existing = bySession.get(entry.sessionId);
    if (!existing || entry.timestamp > existing.timestamp) {
      bySession.set(entry.sessionId, entry);
    }
  }

  let items = await Promise.all(Array.from(bySession.values()).map(async (entry) => {
    const projectDir = encodeProject(entry.project || '');
    const filePath = getConversationFilePath(projectDir, entry.sessionId);
    const fileSize = await getFileSize(filePath);
    return {
      sessionId: entry.sessionId,
      project: entry.project || '',
      projectDir,
      display: entry.display || '',
      timestamp: entry.timestamp,
      fileSize,
      exists: fileSize > 0
    };
  }));

  // Filter out entries whose files don't exist
  items = items.filter(i => i.exists);

  // Filter by project
  if (project) {
    items = items.filter(i => i.projectDir === project);
  }

  // Search filter
  if (search) {
    const q = search.toLowerCase();
    items = items.filter(i => i.display.toLowerCase().includes(q));
  }

  // Sort by date desc
  items.sort((a, b) => b.timestamp - a.timestamp);

  const total = items.length;
  const totalPages = Math.ceil(total / limit);
  const start = (page - 1) * limit;
  const paged = items.slice(start, start + limit);

  return {
    conversations: paged,
    total,
    page,
    totalPages,
    limit
  };
}

function extractContent(message) {
  if (!message || !message.content) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('\n');
  }
  return '';
}

function extractThinking(message) {
  if (!message || !message.content || !Array.isArray(message.content)) return '';
  return message.content
    .filter(b => b.type === 'thinking')
    .map(b => b.thinking || '')
    .join('\n');
}

async function getConversation(projectDir, sessionId) {
  validateParam('projectDir', projectDir);
  validateParam('sessionId', sessionId);
  const filePath = getConversationFilePath(projectDir, sessionId);
  const records = await parseJsonl(filePath);
  if (!records.length) return null;

  const messages = [];
  for (const record of records) {
    if (record.type === 'user' && record.message) {
      messages.push({
        role: 'user',
        content: extractContent(record.message),
        timestamp: record.timestamp || null
      });
    } else if (record.type === 'assistant' && record.message) {
      messages.push({
        role: 'assistant',
        content: extractContent(record.message),
        thinking: extractThinking(record.message),
        timestamp: record.timestamp || null
      });
    }
  }

  return messages;
}

async function deleteConversation(projectDir, sessionId) {
  validateParam('projectDir', projectDir);
  validateParam('sessionId', sessionId);
  const filePath = getConversationFilePath(projectDir, sessionId);
  const fileSize = await getFileSize(filePath);
  if (!fileSize) return null;

  // Delete conversation file
  try {
    await fsp.unlink(filePath);
  } catch (err) {
    console.error(`Failed to delete conversation file ${filePath}:`, err.message);
    throw err;
  }

  // Remove from history.jsonl
  try {
    const content = await fsp.readFile(HISTORY_FILE, 'utf-8');
    const lines = content.trim().split('\n');
    const filtered = lines.filter(line => {
      try {
        const obj = JSON.parse(line);
        return obj.sessionId !== sessionId;
      } catch {
        return true;
      }
    });
    const tmpFile = HISTORY_FILE + '.tmp';
    await fsp.writeFile(tmpFile, filtered.join('\n') + '\n');
    await fsp.rename(tmpFile, HISTORY_FILE);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Failed to rewrite history after deleting ${sessionId}:`, err.message);
      throw err;
    }
  }

  invalidateMetricsCache();
  return { success: true, freedBytes: fileSize };
}

async function bulkDeleteConversations({ search, project, sessionIds } = {}) {
  // Find conversations to delete
  let toDelete;

  if (sessionIds && sessionIds.length > 0) {
    // Delete specific sessions — look them up in history to get projectDir
    const history = await parseJsonl(HISTORY_FILE);
    const bySession = new Map();
    for (const entry of history) {
      const existing = bySession.get(entry.sessionId);
      if (!existing || entry.timestamp > existing.timestamp) {
        bySession.set(entry.sessionId, entry);
      }
    }
    toDelete = sessionIds
      .filter(id => bySession.has(id))
      .map(id => {
        const entry = bySession.get(id);
        return {
          sessionId: id,
          projectDir: encodeProject(entry.project || '')
        };
      });
  } else if (search || project) {
    // Find ALL matching conversations from history
    const result = await listConversations({ search, project, page: 1, limit: 999999 });
    if (result.conversations.length > 500) {
      return { error: 'Too many matching conversations (max 500). Use more specific filters.' };
    }
    toDelete = result.conversations.map(c => ({
      sessionId: c.sessionId,
      projectDir: c.projectDir
    }));
  } else {
    return null; // No params — caller should return 400
  }

  if (toDelete.length === 0) {
    return { success: true, deletedCount: 0, freedBytes: 0 };
  }

  // Collect sessionIds to delete as a Set for fast lookup
  const deleteSet = new Set(toDelete.map(d => d.sessionId));

  // Step 1: Delete conversation files first
  let freedBytes = 0;
  for (const item of toDelete) {
    const filePath = getConversationFilePath(item.projectDir, item.sessionId);
    const size = await getFileSize(filePath);
    if (size > 0) {
      try {
        await fsp.unlink(filePath);
        freedBytes += size;
      } catch (err) {
        console.error(`Failed to delete ${filePath}:`, err.message);
      }
    }
  }

  // Step 2: Rewrite history.jsonl atomically in ONE pass
  try {
    const content = await fsp.readFile(HISTORY_FILE, 'utf-8');
    const lines = content.trim().split('\n');
    const filtered = lines.filter(line => {
      try {
        const obj = JSON.parse(line);
        return !deleteSet.has(obj.sessionId);
      } catch {
        return true;
      }
    });
    const tmpFile = HISTORY_FILE + '.tmp';
    await fsp.writeFile(tmpFile, filtered.join('\n') + '\n');
    await fsp.rename(tmpFile, HISTORY_FILE);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Failed to rewrite history.jsonl during bulk delete:', err.message);
      throw err;
    }
  }

  invalidateMetricsCache();
  return { success: true, deletedCount: deleteSet.size, freedBytes };
}

async function exportConversation(projectDir, sessionId, format) {
  validateParam('projectDir', projectDir);
  validateParam('sessionId', sessionId);
  const filePath = getConversationFilePath(projectDir, sessionId);

  if (format === 'json') {
    try {
      return await fsp.readFile(filePath, 'utf-8');
    } catch (err) {
      if (err.code === 'ENOENT') return null;
      console.error(`Failed to read conversation file for export ${filePath}:`, err.message);
      throw err;
    }
  }

  // Markdown format
  const messages = await getConversation(projectDir, sessionId);
  if (!messages) return null;

  let md = `# Conversation ${sessionId}\n\n`;
  md += `**Project**: ${projectDir}\n\n---\n\n`;

  for (const msg of messages) {
    if (msg.role === 'user') {
      md += `## User\n\n${msg.content}\n\n---\n\n`;
    } else {
      if (msg.thinking) {
        md += `> **Thinking**\n>\n> ${msg.thinking.replace(/\n/g, '\n> ')}\n\n`;
      }
      md += `## Assistant\n\n${msg.content}\n\n---\n\n`;
    }
  }

  return md;
}

async function getStats() {
  const history = await parseJsonl(HISTORY_FILE);
  const bySession = new Map();
  for (const entry of history) {
    const existing = bySession.get(entry.sessionId);
    if (!existing || entry.timestamp > existing.timestamp) {
      bySession.set(entry.sessionId, entry);
    }
  }

  let totalSize = 0;
  let fileCount = 0;
  const projectSet = new Set();

  for (const entry of bySession.values()) {
    const projectDir = encodeProject(entry.project || '');
    const filePath = getConversationFilePath(projectDir, entry.sessionId);
    const size = await getFileSize(filePath);
    if (size > 0) {
      totalSize += size;
      fileCount++;
      projectSet.add(entry.project || '');
    }
  }

  return {
    totalConversations: fileCount,
    totalSize,
    totalProjects: projectSet.size
  };
}

// Metrics cache with 60-second TTL
let metricsCache = null;
let metricsCacheTime = 0;
const METRICS_CACHE_TTL = 60000;

function invalidateMetricsCache() {
  metricsCache = null;
  metricsCacheTime = 0;
}

function countWordsInContent(message) {
  if (!message || !message.content) return 0;
  let text = '';
  if (typeof message.content === 'string') {
    text = message.content;
  } else if (Array.isArray(message.content)) {
    text = message.content
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join(' ');
  }
  if (!text.trim()) return 0;
  return text.trim().split(/\s+/).length;
}

async function processConversationFileSmall(filePath) {
  let content;
  try {
    content = await fsp.readFile(filePath, 'utf-8');
  } catch (err) {
    console.error(`Failed to read conversation file ${filePath}:`, err.message);
    return { messages: 0, words: 0 };
  }
  const lines = content.trim().split('\n').filter(Boolean);
  let messages = 0;
  let words = 0;
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (record.type === 'user' || record.type === 'assistant') {
        messages++;
        if (record.message) {
          words += countWordsInContent(record.message);
        }
      }
    } catch {
      // skip malformed lines
    }
  }
  return { messages, words };
}

function processConversationFileLarge(filePath) {
  return new Promise((resolve) => {
    let messages = 0;
    let words = 0;
    let rl;
    try {
      rl = readline.createInterface({
        input: fs.createReadStream(filePath, 'utf-8'),
        crlfDelay: Infinity
      });
    } catch (err) {
      console.error(`Failed to open large conversation file ${filePath}:`, err.message);
      return resolve({ messages: 0, words: 0 });
    }
    rl.on('line', (line) => {
      if (!line.trim()) return;
      try {
        const record = JSON.parse(line);
        if (record.type === 'user' || record.type === 'assistant') {
          messages++;
          if (record.message) {
            words += countWordsInContent(record.message);
          }
        }
      } catch {
        // skip malformed lines
      }
    });
    rl.on('close', () => resolve({ messages, words }));
    rl.on('error', () => resolve({ messages, words }));
  });
}

const TEN_MB = 10 * 1024 * 1024;

async function getMetrics() {
  if (metricsCache && (Date.now() - metricsCacheTime) < METRICS_CACHE_TTL) {
    return metricsCache;
  }

  const history = await parseJsonl(HISTORY_FILE);
  const bySession = new Map();
  for (const entry of history) {
    const existing = bySession.get(entry.sessionId);
    if (!existing || entry.timestamp > existing.timestamp) {
      bySession.set(entry.sessionId, entry);
    }
  }

  let totalConversations = 0;
  let totalSize = 0;
  let totalMessages = 0;
  let totalWords = 0;
  const projectMap = new Map();

  for (const entry of bySession.values()) {
    const projectDir = encodeProject(entry.project || '');
    const filePath = getConversationFilePath(projectDir, entry.sessionId);
    const size = await getFileSize(filePath);
    if (size === 0) continue;

    totalConversations++;
    totalSize += size;

    let result;
    if (size > TEN_MB) {
      result = await processConversationFileLarge(filePath);
    } else {
      result = await processConversationFileSmall(filePath);
    }

    totalMessages += result.messages;
    totalWords += result.words;

    const projectName = entry.project || '';
    if (!projectMap.has(projectName)) {
      projectMap.set(projectName, { project: projectName, count: 0, size: 0, messages: 0, words: 0 });
    }
    const proj = projectMap.get(projectName);
    proj.count++;
    proj.size += size;
    proj.messages += result.messages;
    proj.words += result.words;
  }

  const estimatedTokens = Math.round(totalWords * 1.3);
  const byProject = Array.from(projectMap.values()).map(p => ({
    project: p.project,
    count: p.count,
    size: p.size,
    messages: p.messages,
    tokens: Math.round(p.words * 1.3)
  }));
  byProject.sort((a, b) => b.count - a.count);

  const metrics = {
    totalConversations,
    totalSize,
    totalMessages,
    estimatedTokens,
    byProject
  };

  metricsCache = metrics;
  metricsCacheTime = Date.now();
  return metrics;
}

module.exports = {
  getProjects,
  listConversations,
  getConversation,
  deleteConversation,
  bulkDeleteConversations,
  exportConversation,
  getStats,
  getMetrics
};
